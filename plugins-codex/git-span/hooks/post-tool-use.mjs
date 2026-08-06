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
    const record = toolResponse;
    return record.interrupted === true || record.timedOutAfterMs !== void 0;
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
    const join6 = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join6 !== void 0) {
      if (join6 === "&&" && prevVerdict === "failed" || join6 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join6 === "&&" ? "failed" : "succeeded");
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
import { basename as basename3, isAbsolute as isAbsolute2, join as joinPath, resolve as resolvePath } from "node:path";

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
          const trimmed = buf.trimEnd();
          let dupRedirect = false;
          if (trimmed.endsWith(">")) {
            const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
            dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
          }
          if (next === ">" || dupRedirect || last === "<") {
            buf += c;
            i += 1;
            continue;
          }
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
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join6, results) {
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
        join: join6,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join6,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join6, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join6, results);
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
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join6 }
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
          join: join6,
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
          join: join6,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join6, results);
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
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join6) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join6 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join6 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join6
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join6, results) {
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
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join6);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join: join6 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join6, results) {
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
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join6 }
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
function matchTruncateOperands(args, dir, simpleCommandIndex, join6, results) {
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
        join: join6,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join6, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "rm") {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join6, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join6, results);
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
        join6,
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
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join6, results) {
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
            join: join6,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join6 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join6,
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
              join: join6,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join6 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join6,
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
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join6, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join6, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "sed") {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join6, results);
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
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join6, results) {
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
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join6 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join6 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join6 }
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
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join6, results) {
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
        join: join6,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join6, results) {
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
      join6,
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
      join6,
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
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join6, results) {
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
        join: join6,
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
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join6, results) {
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
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join6 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join6) {
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
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join6 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join6, results) {
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
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join6);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join6, results) {
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
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join6);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join6, results) {
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
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join6, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join6, results);
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
  const emitCandidate = (c, frame, simpleCommandIndex, join6) => {
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
        join: join6
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

// src/common/parse-response.ts
import { existsSync as existsSync2, statSync as statSync5 } from "node:fs";
import { dirname as dirname4, join as join5, resolve as resolvePath2, sep } from "node:path";
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
    return statSync5(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync2(join5(dir, ".git"))) return dir;
    const parent = dirname4(dir);
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
      if (bashResponseInterrupted(input.tool_response)) return void 0;
      const matches = parseCommandDetailed(command2, effectiveCwd);
      const blocks2 = await runBashTouches(
        matches,
        sessionId,
        effectiveCwd,
        input.tool_response,
        executors,
        memo,
        (message) => ctx.logger.warn(message)
      );
      const response = normalizeShellResponse(input.tool_response);
      if (response !== null) {
        for (const span of parseResponse({ command: command2, cwd: effectiveCwd, ...response })) {
          const absPath = abspathAgainst(effectiveCwd, span.absolutePath);
          const scope = resolveTouchScope(effectiveCwd, absPath);
          if (!scope) continue;
          const output = await runTouchHook(
            {
              kind: "read",
              sessionId,
              cwd: effectiveCwd,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY29tbW9uL3BhcnNlLXJlc3BvbnNlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBDb2RleCBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCBoZWFsICsgc3VyZmFjZSBhZnRlciBhIGNvbmZpcm1lZCBgYXBwbHlfcGF0Y2hgLFxuICogb3IgYSBzaGVsbC9leGVjIGNhbGwgd2hvc2UgY29tbWFuZCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIGZpbGUrbGluZSBpZGlvbXMuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBoYXMgcnVuLCBzbyB0aGlzIGlzIHRoZSBhY2N1cmF0ZSBob21lIGZvclxuICogdGhlIHRvdWNoIHNpZ25hbDogdGhlIGZpbGUgaXMgYWxyZWFkeSB3cml0dGVuLCBzbyBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnRcbiAqIDxmaWxlPiAtLWZpeGAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBhZ2FpbnN0IHJlYWwgYnl0ZXMgYW5kIHRoZSBzdXJmYWNlZCBibG9ja1xuICogcmVmbGVjdHMgdGhlIGhlYWxlZCBhbmNob3JzLiBUaGUgaGFuZGxlciBuYXJyb3dzIHRoZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlXG4gKiAoYHRvb2xfaW5wdXQuY29tbWFuZGAsIFNESy10eXBlZCBgdW5rbm93bmApIGludG8gcGVyLWZpbGUgYW5jaG9ycyB2aWEgdGhlXG4gKiBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIGFuZCByZWNvdmVycyBzaGVsbCBjb21tYW5kc1xuICogZnJvbSBlaXRoZXIgQ29kZXggZW52ZWxvcGUgKGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgSlNPTiBgYXJndW1lbnRzYCwgb3JcbiAqIGNvZGUtbW9kZSBgZXhlY2Agd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgKSB2aWEgdGhlIHNoYXJlZFxuICogW2NvbW1hbmQgcGFyc2VyXSguLi9jb21tb24vcGFyc2UtY29tbWFuZC50cyk7IGVhY2ggdG91Y2hlZCBmaWxlIGlzIHNjb3BlZCB0b1xuICogdGhlIENXRCByZXBvLCBhbmQgZHJpdmVzIHRoZSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmUgXHUyMDE0IHRoZVxuICogc2FtZSBjb3JlIHRoZSBDbGF1ZGUgYWRhcHRlciB1c2VzLlxuICpcbiAqIFR3byBDb2RleC1zcGVjaWZpYyBjb25jZXJucyBhcmUgcHJlc2VydmVkIGZyb20gdGhpcyBmaWxlJ3Mgam91cm5hbGluZ1xuICogcHJlZGVjZXNzb3I6XG4gKlxuICogMS4gKipTdWNjZXNzIGNsYXNzaWZpY2F0aW9uLioqIFRoZSBwYXJzZWQgZW52ZWxvcGUgZGVzY3JpYmVzICppbnRlbnQqLCBub3RcbiAqICAgICpvdXRjb21lKi4gQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHRvb2wgc3VjY2VzcywgYnV0IGFzIGFcbiAqICAgIGR1cmFiaWxpdHkgYmVsdCB3ZSBjbGFzc2lmeSBgdG9vbF9yZXNwb25zZWAgdmlhXG4gKiAgICB7QGxpbmsgY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2V9OiBhIGNvbmZpcm1lZCByZWplY3Rpb24gKGAnZmFpbHVyZSdgKVxuICogICAgc3VwcHJlc3NlcyB0aGUgdG91Y2ggKG5vIHBoYW50b20gaGVhbC9zdXJmYWNlIG9uIGEgcGF0Y2ggdGhhdCBuZXZlclxuICogICAgYXBwbGllZCk7IGEgc3VjY2VzcyBvciBhbiB1bnJlY29nbml6ZWQgc2hhcGUgKGAndW5rbm93bidgLCB3YXJuZWQpIHByb2NlZWRzLlxuICogMi4gKipObyBwb3N0LWVkaXQgcmFuZ2UgcmVjb3ZlcnkgZnJvbSB0aGUgZW52ZWxvcGUuKiogUG9zdFRvb2xVc2UgcnVucyBhZnRlclxuICogICAgdGhlIHBhdGNoIHJld3JvdGUgdGhlIGZpbGUsIHNvIHRoZSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgbm8gbG9uZ2VyIHNpdHNcbiAqICAgIHdoZXJlIHRoZSBlZGl0IGhhcHBlbmVkIGFuZCBjb3VsZCBtaXMtYW5jaG9yIGEgZHVwbGljYXRlLiBUaGUgdG91Y2ggaXNcbiAqICAgIHNjb3BlZCBmaWxlLXdpZGUgKGB3cml0dGVuOiAnJ2AgXHUyMTkyIHdob2xlLWZpbGUpLCB3aGljaCBpcyBleGFjdGx5IHRoZVxuICogICAgYmVoYXZpb3Ige0BsaW5rIHJ1blRvdWNoSG9va30gdGFrZXMgZm9yIGFuIGVtcHR5IHdyaXRlLlxuICpcbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKVxuICogXHUyMDE0IHNlZSB0aGUgdGltZW91dC11bml0cyBzcGlrZSBub3RlOyB0aGUgc291cmNlIHZhbHVlIG11c3Qgc3RheSBpbiBtcyBzbyB0aGVcbiAqIENvZGV4IGJ1aWxkJ3Mgc2Vjb25kcyBjb252ZXJzaW9uIGF0IGVtaXQgcmVtYWlucyBjb3JyZWN0LlxuICovXG5cbmltcG9ydCB7IHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQb3N0VG9vbFVzZUlucHV0LCBwb3N0VG9vbFVzZUhvb2ssIHBvc3RUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7IGFic3BhdGhBZ2FpbnN0IH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCwgcnVuQmFzaFRvdWNoZXMgfSBmcm9tICcuLi9jb21tb24vYmFzaC10b3VjaC5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCB9IGZyb20gJy4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHBhcnNlUmVzcG9uc2UsIHR5cGUgUmVzcG9uc2VQYXJzZUlucHV0IH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLXJlc3BvbnNlLmpzJztcbmltcG9ydCB7IGNyZWF0ZURpc2tNZW1vU3RvcmUsIHR5cGUgTWVtb0ZhY3RvcnksIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMsIHJ1blRvdWNoSG9vaywgdHlwZSBUb3VjaEV4ZWN1dG9ycyB9IGZyb20gJy4uL2NvbW1vbi90b3VjaC1jb3JlLmpzJztcbmltcG9ydCB7IHBhcnNlQXBwbHlQYXRjaCB9IGZyb20gJy4vYXBwbHktcGF0Y2guanMnO1xuXG4vKipcbiAqIFRoZSBwcmVmaXggYXBwbHlfcGF0Y2gncyBzdGRvdXQgY2FycmllcyB3aGVuIFx1MjAxNCBhbmQgb25seSB3aGVuIFx1MjAxNCB0aGUgcGF0Y2hcbiAqIGFwcGxpZWQgKGNvZGV4LXJzL2FwcGx5LXBhdGNoIGBwcmludF9zdW1tYXJ5YCkuIENvZGV4IHN1cmZhY2VzIHRoYXQgc3Rkb3V0XG4gKiB2ZXJiYXRpbSBhcyB0aGUgUG9zdFRvb2xVc2UgYHRvb2xfcmVzcG9uc2VgIChhIGJhcmUgc3RyaW5nIHRvZGF5KS4gRml4ZWRcbiAqIGFjcm9zcyBBZGQvTW9kaWZ5L0RlbGV0ZTsgdGhlIGhlYWRlciBpcyBmb2xsb3dlZCBieSBgQS9NL0QgPHBhdGg+YCBsaW5lcy5cbiAqL1xuY29uc3QgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVggPSAnU3VjY2Vzcy4gVXBkYXRlZCB0aGUgZm9sbG93aW5nIGZpbGVzOic7XG5cbi8qKlxuICogVGhlIGNvbW1vbiBmaWVsZHMgYW4gb2JqZWN0LXdyYXBwZWQgdG9vbF9yZXNwb25zZSBtaWdodCBjYXJyeSB0aGUgdG9vbCdzIHRleHRcbiAqIG91dHB1dCB1bmRlciwgaWYgQ29kZXggZXZlciBzdG9wcyBzdXJmYWNpbmcgaXQgYXMgYSBiYXJlIHN0cmluZy4gT3JkZXJlZCBieVxuICogbGlrZWxpaG9vZDsgdGhlIGZpcnN0IGZpZWxkIHdob3NlIHZhbHVlIGlzIGEgc3RyaW5nIHdpbnMuXG4gKi9cbmNvbnN0IFJFU1BPTlNFX1RFWFRfRklFTERTID0gWydvdXRwdXQnLCAnc3Rkb3V0JywgJ2NvbnRlbnQnLCAndGV4dCddIGFzIGNvbnN0O1xuXG4vKiogTmFycm93IHRoZSBTREsncyBgdW5rbm93bmAgdG9vbF9pbnB1dCB0byB0aGUgYGFwcGx5X3BhdGNoYCBgeyBjb21tYW5kIH1gIHNoYXBlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdjb21tYW5kJyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBOYXJyb3cgdGhlIGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgZW52ZWxvcGUgKGNsaV92ZXJzaW9uIFx1MjI2NCAwLjEzMC4wKTpcbiAqIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OICpzdHJpbmcqIG9mIHNoYXBlXG4gKiBge1wiY21kXCI6IFwiLi4uXCIsIFwid29ya2RpclwiOiBcIi4uLlwifWAgXHUyMDE0IHBhcnNlIGl0IGFuZCByZXR1cm4gdGhlIGBjbWRgIGFuZFxuICogYHdvcmtkaXJgLiBSZXR1cm5zIGBudWxsYCBmb3IgYW55IG90aGVyIHNoYXBlIChub3QgSlNPTiwgbm8gYGNtZGAgZmllbGQsIG9yXG4gKiBub3QgdGhpcyBlbnZlbG9wZSk7IGB3b3JrZGlyYCBpcyBgbnVsbGAgd2hlbiBhYnNlbnQgb3Igbm90IGEgc3RyaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93RXhlY0NvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogeyBjbWQ6IHN0cmluZzsgd29ya2Rpcjogc3RyaW5nIHwgbnVsbCB9IHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2FyZ3VtZW50cycgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgYXJncyA9ICh0b29sSW5wdXQgYXMgeyBhcmd1bWVudHM6IHVua25vd24gfSkuYXJndW1lbnRzO1xuICAgIGlmICh0eXBlb2YgYXJncyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXJncyk7XG4gICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIHsgY21kOiBwYXJzZWQuY21kLCB3b3JrZGlyOiB0eXBlb2YgcGFyc2VkLndvcmtkaXIgPT09ICdzdHJpbmcnID8gcGFyc2VkLndvcmtkaXIgOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBuYXJyb3dpbmcgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUuIGBtYXRjaGVkYCBzZXBhcmF0ZXNcbiAqIFwidGhlIGVudmVsb3BlIHdhcyBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdFxuICogYmUgcmVjb3ZlcmVkXCIgKGEgdmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZCBcdTIwMTQgc3RhdGljYWxseSB1bnJlc29sdmFibGUpXG4gKiBmcm9tIFwidGhlIGVudmVsb3BlIGlzIG5vdCBjb2RlLW1vZGUgZXhlYyBhdCBhbGxcIiwgc28gdGhlIGhhbmRsZXIgY2FuIHdhcm4gb25cbiAqIHRoZSBmb3JtZXIgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0aW5nIGl0IHdpdGggdGhlIGxhdHRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICAvKiogV2hldGhlciBgdG9vbF9pbnB1dC5pbnB1dGAgY29udGFpbmVkIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwuICovXG4gIG1hdGNoZWQ6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGBjbWRgIHN0cmluZywgb3IgYG51bGxgIHdoZW4gbWF0Y2hlZCBidXQgdW5wYXJzYWJsZSAvIGFic2VudC4gKi9cbiAgY21kOiBzdHJpbmcgfCBudWxsO1xuICAvKiogVGhlIHJlY292ZXJlZCBgd29ya2RpcmAgc3RyaW5nLCBvciBgbnVsbGAgd2hlbiBhYnNlbnQgb3Igbm90IGEgc3RyaW5nLiAqL1xuICB3b3JrZGlyOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFF1b3RlIGJhcmUgaWRlbnRpZmllciBrZXlzIGluIGEgSlMgb2JqZWN0IGxpdGVyYWwgc28gYEpTT04ucGFyc2VgIGNhbiByZWFkXG4gKiBpdC4gUmVhbCBjb2RlLW1vZGUgY2FsbCBzaXRlcyBlbWl0IEpTLXN0eWxlIHVucXVvdGVkIGtleXNcbiAqIChge2NtZDpcInNlZCAtbiAnMSwyNDBwJyAvcGF0aFwiLC4uLn1gKSwgd2hpY2ggaXMgdmFsaWQgSlMgYnV0IGludmFsaWQgSlNPTi5cbiAqIFN0cmluZyB2YWx1ZXMgKHNpbmdsZS0gb3IgZG91YmxlLXF1b3RlZCkgYXJlIGNvcGllZCB2ZXJiYXRpbSBcdTIwMTQgaW5jbHVkaW5nIGFueVxuICogYCwga2V5OmAtc2hhcGVkIHRleHQgaW5zaWRlIHRoZW0gXHUyMDE0IGFuZCBhbHJlYWR5LXF1b3RlZCBrZXlzIHBhc3MgdGhyb3VnaFxuICogdW50b3VjaGVkLlxuICovXG5mdW5jdGlvbiBxdW90ZU9iamVjdEtleXMobGl0ZXJhbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBsaXRlcmFsLmxlbmd0aDtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGxpdGVyYWxbaV07XG4gICAgaWYgKGMgPT09ICdcIicgfHwgYyA9PT0gXCInXCIpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbikge1xuICAgICAgICBpZiAobGl0ZXJhbFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikgaSArPSAyO1xuICAgICAgICBlbHNlIGlmIChsaXRlcmFsW2ldID09PSBxdW90ZSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBsaXRlcmFsLnNsaWNlKHN0YXJ0LCBpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBrZXkgPSBsaXRlcmFsLnNsaWNlKGkpLm1hdGNoKC9eKFxce3wsKVxccyooW0EtWmEtel8kXVtBLVphLXowLTlfJF0qKVxccyo6Lyk7XG4gICAgaWYgKGtleSkge1xuICAgICAgb3V0ICs9IGAke2tleVsxXX1cIiR7a2V5WzJdfVwiOmA7XG4gICAgICBpICs9IGtleVswXS5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjUgMC4xNDQuMCk6XG4gKiBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHRoYXQgY2FsbHMgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIFx1MjAxNFxuICogcmVjb3ZlciB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnQgdmlhIGJhbGFuY2VkLWJyYWNlIG1hdGNoaW5nLCBxdW90ZSBpdHNcbiAqIHVucXVvdGVkIEpTIGtleXMsIGFuZCBwYXJzZSBpdC4gQSBjb21tYW5kIGJ1aWx0IGZyb20gdmFyaWFibGVzIG9yIHRlbXBsYXRlXG4gKiBsaXRlcmFscyBpcyBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZTogdGhlIGNhbGwgc3RpbGwgKm1hdGNoZWQqIGJ1dCB5aWVsZHNcbiAqIGBjbWQ6IG51bGxgLCByZXBvcnRlZCBkaXN0aW5jdGx5IGZyb20gYSBub24tY29kZS1tb2RlIGVudmVsb3BlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93Q29kZU1vZGVFeGVjKHRvb2xJbnB1dDogdW5rbm93bik6IENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2lucHV0JyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBpbnB1dCA9ICh0b29sSW5wdXQgYXMgeyBpbnB1dDogdW5rbm93biB9KS5pbnB1dDtcbiAgICBpZiAodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gTWF0Y2ggdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KSBcdTIwMTQgZXh0cmFjdCB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnRcbiAgICAgIGNvbnN0IG1hdGNoID0gaW5wdXQubWF0Y2goL3Rvb2xzXFwuZXhlY19jb21tYW5kXFwoXFxzKihcXHsoPzpbXnt9XXxcXHsoPzpbXnt9XXxcXHtbXnt9XSpcXH0pKlxcfSkqXFx9KVxccypcXCkvKTtcbiAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocXVvdGVPYmplY3RLZXlzKG1hdGNoWzFdKSk7XG4gICAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIG1hdGNoZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGNtZDogcGFyc2VkLmNtZCxcbiAgICAgICAgICAgICAgd29ya2RpcjogdHlwZW9mIHBhcnNlZC53b3JrZGlyID09PSAnc3RyaW5nJyA/IHBhcnNlZC53b3JrZGlyIDogbnVsbFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG1hdGNoZWQsIGJ1dCB0aGUgbGl0ZXJhbCBkaWQgbm90IHBhcnNlIFx1MjAxNCB0aGUgY2FsbCBpcyBzdGlsbCBhXG4gICAgICAgICAgLy8gY29kZS1tb2RlIGV4ZWMgd2hvc2UgY29tbWFuZCBjYW5ub3QgYmUgcmVjb3ZlcmVkIHN0YXRpY2FsbHkuXG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsLCB3b3JrZGlyOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbWF0Y2hlZDogZmFsc2UsIGNtZDogbnVsbCwgd29ya2RpcjogbnVsbCB9O1xufVxuXG4vKiogVGhlIHNoZWxsIGB0b29sX3Jlc3BvbnNlYCBmaWVsZHMgYSByZXNwb25zZS1hd2FyZSBwYXJzZSBjb250cmlidXRlcywgYmVmb3JlIGBjb21tYW5kYC9gY3dkYCBhcmUgYXR0YWNoZWQgYXQgdGhlIGNhbGwgc2l0ZS4gKi9cbnR5cGUgTm9ybWFsaXplZFNoZWxsUmVzcG9uc2UgPSBQaWNrPFxuICBSZXNwb25zZVBhcnNlSW5wdXQsXG4gICdzdGRvdXQnIHwgJ3N0ZGVycicgfCAnZXhpdFN0YXR1cycgfCAndHJ1bmNhdGVkJyB8ICdpbnRlcnJ1cHRlZCdcbj47XG5cbi8qKlxuICogVG9sZXJhbnRseSBub3JtYWxpemUgdGhlIHRvb2wncyB0ZXh0dWFsIG91dHB1dCBhbmQgbWV0YWRhdGEgb3V0IG9mIGFcbiAqIGB0b29sX3Jlc3BvbnNlYCBvZiB1bmNlcnRhaW4gc2hhcGUgKFNESy10eXBlZCBgdW5rbm93bmApOiBhIGJhcmUgc3RyaW5nXG4gKiAodG9kYXkncyBDb2RleCkgaXMgdXNlZCBhcy1pczsgYSB0ZXh0LWJsb2NrIGFycmF5IGpvaW5zIGl0cyBibG9ja3M7IGFuXG4gKiBvYmplY3QgaXMgcHJvYmVkIGZvciB0aGUgZmlyc3Qge0BsaW5rIFJFU1BPTlNFX1RFWFRfRklFTERTfSBlbnRyeSB0aGF0XG4gKiBob2xkcyBhIHN0cmluZywgY2FycnlpbmcgYWxvbmcgYHN0ZGVycmAsIGBleGl0Q29kZWAvYGV4aXRTdGF0dXNgLCBhbmQgdGhlXG4gKiB0d28tcmVnaW1lIG1hcmtlcnMgd2hlbiB0aGUgZW52ZWxvcGUgaGFzIHRoZW0gXHUyMDE0IGByYXdPdXRwdXRQYXRoYCBzZXQgKHRoZVxuICogaW5saW5lIHN0ZG91dCBpcyBvbmx5IGEgcHJldmlldykgYmVjb21lcyBgdHJ1bmNhdGVkOiB0cnVlYDsgYGludGVycnVwdGVkYFxuICogb3IgYHRpbWVkT3V0QWZ0ZXJNc2AgKHRoZSBjb21tYW5kIHdhcyBjdXQgb2ZmIG1pZC1ydW4pIGJlY29tZXNcbiAqIGBpbnRlcnJ1cHRlZDogdHJ1ZWAsIHRoZSBjb21wbGV0ZS1yZWNvcmRzIHJlZ2ltZSBcdTIwMTQgdGhlIHNhbWUgbm9ybWFsaXphdGlvblxuICogdGhlIENsYXVkZSBhZGFwdGVyIGFwcGxpZXMgdG8gaXRzIEJhc2ggZW52ZWxvcGUuIFJldHVybnMgYG51bGxgIHdoZW4gbm9cbiAqIHRleHQgY2FuIGJlIHJlY292ZXJlZCAodW5rbm93biBvYmplY3Qgc2hhcGUsIGBudWxsYCwgb3IgYSBub24tc3RyaW5nL1xuICogbm9uLW9iamVjdCksIHdoaWNoIHRoZSBjYWxsZXIgdHJlYXRzIGFzIGFuICp1bnJlY29nbml6ZWQqIFx1MjAxNCBub3QgKmZhaWxlZCogXHUyMDE0XG4gKiByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU2hlbGxSZXNwb25zZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiBOb3JtYWxpemVkU2hlbGxSZXNwb25zZSB8IG51bGwge1xuICBpZiAodHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ3N0cmluZycpIHJldHVybiB7IHN0ZG91dDogdG9vbFJlc3BvbnNlIH07XG4gIGlmIChBcnJheS5pc0FycmF5KHRvb2xSZXNwb25zZSkpIHtcbiAgICBjb25zdCB0ZXh0OiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgdG9vbFJlc3BvbnNlKSB7XG4gICAgICBpZiAoYmxvY2sgIT09IG51bGwgJiYgdHlwZW9mIGJsb2NrID09PSAnb2JqZWN0Jykge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IChibG9jayBhcyB7IHRleHQ/OiB1bmtub3duIH0pLnRleHQ7XG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB0ZXh0LnB1c2godmFsdWUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBzdGRvdXQ6IHRleHQuam9pbignJykgfTtcbiAgfVxuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVjb3JkID0gdG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgUkVTUE9OU0VfVEVYVF9GSUVMRFMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2ZpZWxkXTtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgc3Rkb3V0OiB2YWx1ZSxcbiAgICAgICAgICBzdGRlcnI6IHR5cGVvZiByZWNvcmQuc3RkZXJyID09PSAnc3RyaW5nJyA/IHJlY29yZC5zdGRlcnIgOiB1bmRlZmluZWQsXG4gICAgICAgICAgZXhpdFN0YXR1czpcbiAgICAgICAgICAgIHR5cGVvZiByZWNvcmQuZXhpdENvZGUgPT09ICdudW1iZXInXG4gICAgICAgICAgICAgID8gcmVjb3JkLmV4aXRDb2RlXG4gICAgICAgICAgICAgIDogdHlwZW9mIHJlY29yZC5leGl0U3RhdHVzID09PSAnbnVtYmVyJ1xuICAgICAgICAgICAgICAgID8gcmVjb3JkLmV4aXRTdGF0dXNcbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICB0cnVuY2F0ZWQ6IHJlY29yZC5yYXdPdXRwdXRQYXRoICE9PSB1bmRlZmluZWQsXG4gICAgICAgICAgaW50ZXJydXB0ZWQ6IHJlY29yZC5pbnRlcnJ1cHRlZCA9PT0gdHJ1ZSB8fCByZWNvcmQudGltZWRPdXRBZnRlck1zICE9PSB1bmRlZmluZWRcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogQ2xhc3NpZnkgYW4gYGFwcGx5X3BhdGNoYCBgdG9vbF9yZXNwb25zZWAgZm9yIHRoZSB0b3VjaCBnYXRlOlxuICpcbiAqIC0gYCdzdWNjZXNzJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBmcm9tIGEgYmFyZSBzdHJpbmcgb3IgYSB0ZXh0LWZpZWxkXG4gKiAgIG9iamVjdCBhbmQgY2FycmllcyB7QGxpbmsgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVh9LlxuICogLSBgJ2ZhaWx1cmUnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGZyb20gYSBiYXJlIHN0cmluZyBvciBhIHRleHQtZmllbGRcbiAqICAgb2JqZWN0IGJ1dCBsYWNrcyB0aGUgaGVhZGVyOiBhIGdlbnVpbmUgcmVqZWN0aW9uIG9yIGVycm9yLiBUaGUgT05MWVxuICogICBjbGFzc2lmaWNhdGlvbiB0aGF0IHN1cHByZXNzZXMgdGhlIHRvdWNoLlxuICogLSBgJ3Vua25vd24nYCBcdTIwMTQgbm8gdGV4dCBjb3VsZCBiZSByZWNvdmVyZWQgKHVucmVjb2duaXplZCBzaGFwZSksIG9yIHRoZVxuICogICByZXNwb25zZSBpcyBhIGJsb2NrL3RleHQgYXJyYXkuIFdlIHByb2NlZWQgZGVmZW5zaXZlbHkgaGVyZSByYXRoZXIgdGhhblxuICogICByaXNrIG1pc3NpbmcgYSByZWFsIGVkaXQncyBoZWFsL3N1cmZhY2U7IENvZGV4IGNvcmUgZmlyZXMgUG9zdFRvb2xVc2VcbiAqICAgb25seSBvbiBzdWNjZXNzLCBzbyB0aGlzIGNhbm5vdCBoZWFsL3N1cmZhY2UgYSBwYXRjaCB0aGF0IG5ldmVyIGFwcGxpZWQuXG4gKlxuICogVGhlIGFycmF5IGNoZWNrIHJlc3RvcmVzIHRoZSBwcmUtbm9ybWFsaXplciBjb250cmFjdDogdGhlIGJhc2VsaW5lXG4gKiBgZXh0cmFjdFJlc3BvbnNlVGV4dGAgcmV0dXJuZWQgYG51bGxgIGZvciBldmVyeSBhcnJheSBzaGFwZSAodGV4dC1ibG9jayxcbiAqIGVtcHR5LCBub24tdGV4dCksIHNvIGFycmF5cyBjbGFzc2lmaWVkIGAndW5rbm93bidgIGFuZCBwcm9jZWVkZWQgd2l0aCBhXG4gKiB3YXJuaW5nLiBgbm9ybWFsaXplU2hlbGxSZXNwb25zZWAgZGVsaWJlcmF0ZWx5IHdpZGVuZWQgdG8gYXJyYXlzIGZvciB0aGVcbiAqIHNoZWxsLXBhcnNlIGV2aWRlbmNlIHNvdXJjZSwgc28gY2xhc3NpZmljYXRpb24gcmVhZHMgdGhlIHJhdyBlbnZlbG9wZSB0b1xuICoga2VlcCB0aGUgYXBwbHlfcGF0Y2ggZ2F0ZSBiZWhhdmlvci1pZGVudGljYWwgXHUyMDE0IGEgam9pbmVkIGFycmF5IHdob3NlIHRleHRcbiAqIG1lcmVseSBsYWNrcyB0aGUgc3VjY2VzcyBoZWFkZXIgbXVzdCBuZXZlciBiZSBtaXN0YWtlbiBmb3IgYSBjb25maXJtZWRcbiAqIHJlamVjdGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKHRvb2xSZXNwb25zZTogdW5rbm93bik6ICdzdWNjZXNzJyB8ICdmYWlsdXJlJyB8ICd1bmtub3duJyB7XG4gIGlmIChBcnJheS5pc0FycmF5KHRvb2xSZXNwb25zZSkpIHJldHVybiAndW5rbm93bic7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVTaGVsbFJlc3BvbnNlKHRvb2xSZXNwb25zZSk7XG4gIGlmIChub3JtYWxpemVkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICByZXR1cm4gbm9ybWFsaXplZC5zdGRvdXQuc3RhcnRzV2l0aChBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCkgPyAnc3VjY2VzcycgOiAnZmFpbHVyZSc7XG59XG5cbi8qKiBBIHJlYWRlciB0aGF0IGFsd2F5cyBkZWNsaW5lcywgZm9yY2luZyB0aGUgcGFyc2VyIHRvIHdob2xlLWZpbGUgYW5jaG9ycy4gKi9cbmNvbnN0IG5vUmFuZ2VSZWNvdmVyeSA9ICgpOiBudWxsID0+IG51bGw7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSA9IGNyZWF0ZURpc2tNZW1vU3RvcmVcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQb3N0VG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgdG9vbF9uYW1lID0gaW5wdXQudG9vbF9uYW1lO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcblxuICAgIC8vIFNoZWxsIHRvdWNoOiBleHRyYWN0IHRoZSBjb21tYW5kIGZyb20gd2hpY2hldmVyIGVudmVsb3BlIHNoYXBlIHRoZSBoYXJuZXNzXG4gICAgLy8gZGVsaXZlcnMsIHBhcnNlLCBhbmQgcnVuIGVhY2ggcmVzb2x2ZWQgc3BhbiB0aHJvdWdoIHRoZSBzaGFyZWQgdG91Y2ggY29yZS5cbiAgICAvLyBUaGUgYnJhbmNoIGFsc28gbm9ybWFsaXplcyBgdG9vbF9yZXNwb25zZWAgdmlhIGBub3JtYWxpemVTaGVsbFJlc3BvbnNlYFxuICAgIC8vIGFuZCBtZXJnZXMgYHBhcnNlUmVzcG9uc2VgJ3Mgc3BhbnMgaW4gYXMgcmVhZCB0b3VjaGVzICh0aGUgdG9vbF9yZXNwb25zZVxuICAgIC8vIHBhc3MgYmVsb3cpLlxuICAgIC8vXG4gICAgLy8gLSBgQmFzaGA6IHRoZSBoYXJuZXNzLXVud3JhcHBlZCBzaGFwZSBDb2RleCBcdTIyNjUwLjE0NCBhY3R1YWxseSBzZW5kcyBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmNvbW1hbmRgIGlzIHRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgKHNhbWUgc2hhcGUgdGhlXG4gICAgLy8gICBDbGF1ZGUgYWRhcHRlciBoYW5kbGVzKS5cbiAgICAvLyAtIGBleGVjX2NvbW1hbmRgOiBjbGFzc2ljIGZ1bmN0aW9uX2NhbGwgZW52ZWxvcGUgKGNsaSBcdTIyNjQwLjEzMCkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5hcmd1bWVudHNgIGlzIGEgSlNPTiBzdHJpbmcgd2l0aCBhIGBjbWRgIGZpZWxkLlxuICAgIC8vIC0gYGV4ZWNgOiBkaXJlY3QgY29kZS1tb2RlIGVudmVsb3BlIChtYXkgc2hpcCBpbiBhIGZ1dHVyZSBDTEkpIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuaW5wdXRgIGlzIEpTIHNvdXJjZSB3cmFwcGluZyBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAuXG4gICAgLy9cbiAgICAvLyBBIGNvbW1hbmQgd2l0aCBubyByZWNvZ25pemVkIGlkaW9tIHlpZWxkcyBubyBibG9ja3MgYW5kIHJldHVybnMgdW5kZWZpbmVkIFx1MjAxNFxuICAgIC8vIGZhaWwtb3Blbiwgc2FtZSBhcyB0aGUgYXBwbHlfcGF0Y2ggcGF0aCBiZWxvdy5cbiAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcgfHwgdG9vbF9uYW1lID09PSAnZXhlY19jb21tYW5kJyB8fCB0b29sX25hbWUgPT09ICdleGVjJykge1xuICAgICAgbGV0IGNvbW1hbmQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgbGV0IHdvcmtkaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgaWYgKHRvb2xfbmFtZSA9PT0gJ0Jhc2gnKSB7XG4gICAgICAgIC8vIFRoZSBoYXJuZXNzIGFscmVhZHkgdW53cmFwcGVkIHRoZSBjb2RlLW1vZGUgZW52ZWxvcGUgXHUyMDE0IHRoZSBjb21tYW5kIGlzXG4gICAgICAgIC8vIGluIGB0b29sX2lucHV0LmNvbW1hbmRgLCBleGFjdGx5IGFzIHRoZSBDbGF1ZGUgYWRhcHRlciByZWNlaXZlcyBpdC5cbiAgICAgICAgY29uc3QgcmF3ID0gKGlucHV0LnRvb2xfaW5wdXQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKT8uY29tbWFuZDtcbiAgICAgICAgY29tbWFuZCA9IHR5cGVvZiByYXcgPT09ICdzdHJpbmcnID8gcmF3IDogbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoZSBjbGFzc2ljIGBleGVjX2NvbW1hbmRgIGVudmVsb3BlIGNhcnJpZXMgYHdvcmtkaXJgIGJlc2lkZSBgY21kYFxuICAgICAgICAvLyAocGxhbiBcdTAwQTc4KSBcdTIwMTQgdGhyZWFkIGl0IHRocm91Z2ggbGlrZSB0aGUgY29kZS1tb2RlIGVudmVsb3BlIGJlbG93LlxuICAgICAgICBjb25zdCBjbGFzc2ljID0gbmFycm93RXhlY0NvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICAgIGNvbW1hbmQgPSBjbGFzc2ljPy5jbWQgPz8gbnVsbDtcbiAgICAgICAgd29ya2RpciA9IGNsYXNzaWM/LndvcmtkaXIgPz8gbnVsbDtcbiAgICAgIH1cbiAgICAgIGlmIChjb21tYW5kID09PSBudWxsICYmIHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICAgIC8vIENvZGUtbW9kZSBgZXhlY2Agd3JhcHMgdGhlIHNhbWUgY2FsbCBpbiBKUyBzb3VyY2UuIEEgbWF0Y2hlZCBjYWxsXG4gICAgICAgIC8vIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdCBiZSBwYXJzZWQgKHZhcmlhYmxlL3RlbXBsYXRlLWJ1aWx0IGNvbW1hbmQpXG4gICAgICAgIC8vIGlzIGEgZGlzdGluY3Qgb3V0Y29tZSBmcm9tIFwibm90IGEgY29kZS1tb2RlIGVudmVsb3BlIGF0IGFsbFwiOiB3YXJuIHNvXG4gICAgICAgIC8vIHRoZSBibGluZCBzcG90IGlzIHZpc2libGUgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0ZWQgd2l0aCBubyBtYXRjaC5cbiAgICAgICAgY29uc3QgY29kZU1vZGUgPSBuYXJyb3dDb2RlTW9kZUV4ZWMoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICAgIGlmIChjb2RlTW9kZS5tYXRjaGVkICYmIGNvZGVNb2RlLmNtZCA9PT0gbnVsbCkge1xuICAgICAgICAgIGN0eC5sb2dnZXIud2FybihcbiAgICAgICAgICAgICdDb2RleCBjb2RlLW1vZGUgZXhlYyBlbnZlbG9wZSBtYXRjaGVkIGJ1dCBpdHMgZXhlY19jb21tYW5kIGFyZ3VtZW50IGNvdWxkIG5vdCBiZSBwYXJzZWQ7IG5vIHNoZWxsIHRvdWNoJyxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdG9vbElucHV0VHlwZTogdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQsXG4gICAgICAgICAgICAgIHRvb2xJbnB1dEtleXM6XG4gICAgICAgICAgICAgICAgaW5wdXQudG9vbF9pbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb21tYW5kID0gY29kZU1vZGUuY21kO1xuICAgICAgICB3b3JrZGlyID0gY29kZU1vZGUud29ya2RpcjtcbiAgICAgIH1cbiAgICAgIGlmICghY29tbWFuZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgLy8gUGxhbiBcdTAwQTc4OiBhIHdvcmtkaXIgcHJlc2VudCBhbmQgZnJlZSBvZiBgJGAvYmFja3RpY2sgYWJzb2x1dGl6ZXMgYWdhaW5zdFxuICAgICAgLy8gdGhlIGVudmVsb3BlJ3Mgb3duIGBpbnB1dC5jd2RgIFx1MjAxNCB0aGUgc2hlbGwgdG9vbCByZXNvbHZlcyBhIHJlbGF0aXZlXG4gICAgICAvLyB3b3JrZGlyIGFnYWluc3QgdGhhdCBzYW1lIGJhc2UgXHUyMDE0IGFuZCBpcyB0aGUgc2luZ2xlIGZyYW1lIGZvciB0aGUgd2hvbGVcbiAgICAgIC8vIHRvdWNoIChwYXJzZSBiYXNlLCBhYnNvbHV0aXphdGlvbiwgc2NvcGUgY2hlY2ssIGFuZCB0aGUgdG91Y2ggcmVjb3JkJ3NcbiAgICAgIC8vIGN3ZCwgd2hpY2ggdGhlIGV4ZWN1dG9ycyBkcml2ZSB0aGVpciBnaXQgc3BhbiBydW5zIGZyb20pLiBBXG4gICAgICAvLyB0ZW1wbGF0ZS1saXRlcmFsIHdvcmtkaXIgKGNvbnRhaW5pbmcgYCRgL2JhY2t0aWNrKSBpcyB1bnJlc29sdmFibGUgYW5kXG4gICAgICAvLyBmYWxscyBiYWNrIHRvIGhvb2sgYGN3ZGAuXG4gICAgICBjb25zdCBlZmZlY3RpdmVDd2QgPSB3b3JrZGlyICE9PSBudWxsICYmICEvW2AkXS8udGVzdCh3b3JrZGlyKSA/IHJlc29sdmVQYXRoKGN3ZCwgd29ya2RpcikgOiBjd2Q7XG5cbiAgICAgIC8vIEFuIGludGVycnVwdGVkIGNvbW1hbmQgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zOyB0aGVcbiAgICAgIC8vIGRyaXZlciByZS1jaGVja3MgZGVmZW5zaXZlbHkuXG4gICAgICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQoaW5wdXQudG9vbF9yZXNwb25zZSkpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgZWZmZWN0aXZlQ3dkKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IGF3YWl0IHJ1bkJhc2hUb3VjaGVzKFxuICAgICAgICBtYXRjaGVzLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGVmZmVjdGl2ZUN3ZCxcbiAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSxcbiAgICAgICAgZXhlY3V0b3JzLFxuICAgICAgICBtZW1vLFxuICAgICAgICAobWVzc2FnZSkgPT4gY3R4LmxvZ2dlci53YXJuKG1lc3NhZ2UpXG4gICAgICApO1xuICAgICAgLy8gVGhlIHRvb2xfcmVzcG9uc2UgaXMgYSBzZWNvbmQgZXZpZGVuY2Ugc291cmNlIGZvciB0aGUgc2hlbGw6XG4gICAgICAvLyByZXNwb25zZS1kZXJpdmFibGUgY29tbWFuZHMgKGdyZXAvcmlwZ3JlcCB3aXRoIG51bWJlcmVkIG91dHB1dCxcbiAgICAgIC8vIGdpdCBkaWZmL3Nob3cvbG9nIC1wLCBnaXQgYmxhbWUgLUwpIGxvY2F0ZSB0aGVpciByZWFkIHdpbmRvd3MgaW4gdGhlXG4gICAgICAvLyBvdXRwdXQsIHdoaWNoIHRoZSBjb21tYW5kIHRleHQgYWxvbmUgY2Fubm90LiBOb3JtYWxpemUgdGhlIGVudmVsb3BlLFxuICAgICAgLy8gbWVyZ2UgaXRzIHNwYW5zIHdpdGggdGhlIGNvbW1hbmQtZGVyaXZlZCBvbmVzLCBhbmQgcnVuIGVhY2ggYXMgYVxuICAgICAgLy8gcmVhZCB0b3VjaDsgdGhlIG1lbW8gZGVkdXBlcyBkdXBsaWNhdGUgc3VyZmFjZXMgYWNyb3NzIHRoZSBzb3VyY2VzLlxuICAgICAgLy8gQW4gdW5yZWNvZ25pemVkIGVudmVsb3BlIGRlZ3JhZGVzIHRvIGNvbW1hbmQtb25seSBwYXJzaW5nLlxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBub3JtYWxpemVTaGVsbFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgICAgaWYgKHJlc3BvbnNlICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3BhbiBvZiBwYXJzZVJlc3BvbnNlKHsgY29tbWFuZCwgY3dkOiBlZmZlY3RpdmVDd2QsIC4uLnJlc3BvbnNlIH0pKSB7XG4gICAgICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGVmZmVjdGl2ZUN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgICAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoZWZmZWN0aXZlQ3dkLCBhYnNQYXRoKTtcbiAgICAgICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGtpbmQ6ICdyZWFkJyxcbiAgICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgICBjd2Q6IGVmZmVjdGl2ZUN3ZCxcbiAgICAgICAgICAgICAgZmlsZVBhdGg6IGFic1BhdGgsXG4gICAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICAgIGxpbWl0OiBzcGFuLmxpbmVFbmQgLSBzcGFuLmxpbmVTdGFydCArIDFcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgICAgICBtZW1vXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kID0gbmFycm93QXBwbHlQYXRjaENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAvLyBTdXBwcmVzcyBvbmx5IGEgKmNvbmZpcm1lZCogbm9uLXN1Y2Nlc3MuIEFuIHVucmVjb2duaXplZCByZXNwb25zZSBzaGFwZVxuICAgIC8vIHByb2NlZWRzICh3aXRoIGEgd2FybmluZykgcmF0aGVyIHRoYW4gcmlzayBza2lwcGluZyBhIHJlYWwgZWRpdCdzIHRvdWNoLlxuICAgIGNvbnN0IGNsYXNzaWZpY2F0aW9uID0gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UoaW5wdXQudG9vbF9yZXNwb25zZSk7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAnZmFpbHVyZScpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAndW5rbm93bicpIHtcbiAgICAgIGN0eC5sb2dnZXIud2FybignQ29kZXggYXBwbHlfcGF0Y2ggdG9vbF9yZXNwb25zZSBzaGFwZSB1bnJlY29nbml6ZWQ7IHJ1bm5pbmcgdG91Y2ggZGVmZW5zaXZlbHknLCB7XG4gICAgICAgIHRvb2xSZXNwb25zZVR5cGU6IHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlLFxuICAgICAgICB0b29sUmVzcG9uc2VLZXlzOlxuICAgICAgICAgIGlucHV0LnRvb2xfcmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UgPT09ICdvYmplY3QnXG4gICAgICAgICAgICA/IE9iamVjdC5rZXlzKGlucHV0LnRvb2xfcmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gT25lIGVudmVsb3BlIG1heSB0b3VjaCBzZXZlcmFsIGZpbGVzOyBmb3JjZSB3aG9sZS1maWxlIGFuY2hvcnMgKENvZGV4IG5ldmVyXG4gICAgLy8gcmVjb3ZlcnMgYSBwb3N0LWVkaXQgcmFuZ2UpIGFuZCBydW4gdGhlIHNoYXJlZCB0b3VjaCBjb3JlIHBlciB0b3VjaGVkIGZpbGUuXG4gICAgLy8gVGhlIHNoYXJlZCBtZW1vIGRlZHVwZXMgc3BhbiByZW5kZXJzIGFjcm9zcyBhbmNob3JzIGFuZCB0aGUgc2Vzc2lvbi5cbiAgICBjb25zdCBhbmNob3JzID0gcGFyc2VBcHBseVBhdGNoKGNvbW1hbmQsIG5vUmFuZ2VSZWNvdmVyeSk7XG4gICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIGFuY2hvci5wYXRoKTtcbiAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgLy8gQSBgKioqIERlbGV0ZSBGaWxlOmAgYW5jaG9yIGNhcnJpZXMgdGhlIGFic2VudCBtYXJrZXIgKHBsYW4gXHUwMEE3Myk6IGl0c1xuICAgICAgLy8gdG91Y2ggdGFyZ2V0cyBhYnNlbmNlIFx1MjAxNCB0aGUgZGVsZXRlIGdhdGUgdmVyaWZpZXMgdGhlIHBhdGggaXMgZ29uZSBBTkRcbiAgICAgIC8vIHdhcyByZWFsIChpbmRleC10cmFja2VkIG9yIHNwYW5uZWQpIGJlZm9yZSBmaXJpbmcuIEV2ZXJ5dGhpbmcgZWxzZVxuICAgICAgLy8gdGFyZ2V0cyBleGlzdGVuY2UuXG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICBjd2QsXG4gICAgICAgICAgZmlsZVBhdGg6IGFic1BhdGgsXG4gICAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgICAgdGFyZ2V0U3RhdGU6IGFuY2hvci5hYnNlbnQgPyAnYWJzZW50JyA6ICdleGlzdHMnLFxuICAgICAgICAgIC4uLihhbmNob3IuYWJzZW50ID8geyBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9IH0gOiB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgZXhlY3V0b3JzLFxuICAgICAgICBtZW1vXG4gICAgICApO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwb3N0VG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnYXBwbHlfcGF0Y2h8ZXhlY19jb21tYW5kfGV4ZWN8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgLCBvciBhIHRyYW5zbGF0ZWQgQmFzaCB3cml0ZSBzcGFuKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHBvc3QtZWRpdCByYW5nZSB3aGVuIHN0YXRpY2FsbHkga25vd24gKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcyxcbiAgICogcGF0Y2ggaHVuayB1bmlvbnMpOyBieXBhc3NlcyB7QGxpbmsgcmVjb3ZlclJhbmdlRnJvbURpc2t9IChwbGFuIFx1MDBBNzNcbiAgICogc3RlcCAzKS5cbiAgICovXG4gIHJhbmdlPzogTGluZVJhbmdlO1xuICAvKipcbiAgICogVGhlIGZpbGUncyBleHBlY3RlZCBwb3N0LWNvbW1hbmQgc3RhdGU7IHRoZSB3cml0ZSBwYXRoIGdhdGVzIG9uIGl0IGJlZm9yZVxuICAgKiBpbnZva2luZyBhbnkgZXhlY3V0b3IgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLiBBYnNlbnQgbWVhbnMgYCdleGlzdHMnYCBcdTIwMTQgdGhlXG4gICAqIEVkaXQvV3JpdGUgYW5kIGFwcGx5X3BhdGNoIHBhdGhzJyBkZWZhdWx0LlxuICAgKi9cbiAgdGFyZ2V0U3RhdGU/OiAnZXhpc3RzJyB8ICdhYnNlbnQnO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQsIHZlcmlmaWVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAgICogY2FsbCAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBgY29udGVudGAgY29tcGFyZXMgdGhlIG9uLWRpc2sgc3RhdGUgYWZ0ZXIgdGhlXG4gICAqIGNvbW1hbmQgcmFuOyBgcmVhbERlbGV0ZWAgaXMgZGVsZXRlLW9ubHkgXHUyMDE0IHRoZSBwYXRoIG11c3QgYWxzbyBiZVxuICAgKiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLlxuICAgKi9cbiAgcG9zdFN0YXRlPzoge1xuICAgIC8qKiBgZXhhY3RgOiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YDogZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YDogemVybyBieXRlczsgYHNpemVgOiBieXRlIGNvdW50LiAqL1xuICAgIGNvbnRlbnQ/OiBUb3VjaFBvc3RDb250ZW50O1xuICAgIC8qKiBkZWxldGUtb25seTogdGhlIHBhdGggbXVzdCBhbHNvIGJlIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCAocHJvYmVzIGNhY2hlZCBwZXIgY29tbWFuZCkuICovXG4gICAgcmVhbERlbGV0ZT86IGJvb2xlYW47XG4gIH07XG4gIC8qKlxuICAgKiBjcC9pbnN0YWxsIGRlc3RpbmF0aW9uLXZzLXNvdXJjZSB2ZXJpZmljYXRpb24gKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYVxuICAgKiBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlXG4gICAqIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocmVhbCArIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXJcbiAgICogc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyBcdTIwMTQgdGhlIGRyaXZlcidzIHBhc3MtQSBob2xkKS4gU2V0IGJ5IHRoZVxuICAgKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgY3AgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBuZXZlciBzZXRcbiAgICogYnkgYWRhcHRlcnMuIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZCBcdTIwMTRcbiAgICogc3RyaXBwZWQgb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICogZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogbXYvZ2l0IG12L3BhdGNoIHJlbmFtZSBzb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IHRoZVxuICAgKiBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIFx1MjAxNFxuICAgKiBhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzXG4gICAqIG5ldmVyIHRvdWNoZWQuIE5vIGNvbnRlbnQgY29tcGFyaXNvbiAocGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQpLlxuICAgKiBTZXQgYnkgdGhlIGBydW5CYXNoVG91Y2hlc2AgZHJpdmVyIG9uIHBhaXJlZCByZW5hbWUtY29weSB0b3VjaGVzLlxuICAgKi9cbiAgcmVuYW1lU291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vKipcbiAqIEEgc3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYGV4YWN0YCBcdTIwMTRcbiAqIGZpbGUgYnl0ZXMgZXF1YWw7IGBzdWZmaXhgIFx1MjAxNCBmaWxlIGNvbnRlbnQgZW5kcyB3aXRoIGl0OyBgZW1wdHlgIFx1MjAxNCB6ZXJvXG4gKiBieXRlczsgYHNpemVgIFx1MjAxNCBieXRlIGNvdW50LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFBvc3RDb250ZW50ID0geyBleGFjdDogc3RyaW5nIH0gfCB7IHN1ZmZpeDogc3RyaW5nIH0gfCB7IGVtcHR5OiB0cnVlIH0gfCB7IHNpemU6IG51bWJlciB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3Qtc3RhdGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX06IGEgZGVjaXNpdmUgcGFzcy9mYWlsIGNhcnJpZXNcbiAqIHZlcmRpY3Qgd2VpZ2h0IChjb250ZW50IHZlcmlmaWVkLCBvciBhYnNlbmNlICsgZGVsZXRlLXJlYWxpdHkgdmVyaWZpZWQpO1xuICogYCdpbmNvbmNsdXNpdmUnYCBpcyBldmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgKHNlZCAtaSxcbiAqIHBhdGNoL2dpdCBhcHBseSwgZm9ybWF0dGVycywgcmVzdG9yZS9jaGVja291dCkgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nLCBhbmQgcHJvYmUtaW5hcHBsaWNhYmxlIGNhc2VzIChwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWRcbiAqIGRlbGV0ZXMsIGRpcmVjdG9yeSB0YXJnZXRzKS4gYCdwZW5kaW5nJ2AgaXMgdGhlIGRyaXZlcidzIGFic2VudC1zb3VyY2UgaG9sZFxuICogKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhbiBhYnNlbnQgY3Agc291cmNlIHRoYXQgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIGNhbm5vdFxuICogZGVjaWRlIGl0cyBkZXN0aW5hdGlvbiB1bnRpbCB0aGUgcGFzcy1BIGV4cGxhbmF0aW9uIG1hcCBpcyBjb21wbGV0ZS5cbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGVHYXRlT3V0Y29tZSA9ICdkZWNpc2l2ZVBhc3MnIHwgJ2RlY2lzaXZlRmFpbCcgfCAnaW5jb25jbHVzaXZlJyB8ICdwZW5kaW5nJztcblxuLyoqXG4gKiBQZXItY29tbWFuZCByZWFsaXR5IHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYywgcm91bmQtMyk6IHR3byBsYXp5LFxuICogYmF0Y2hlZCBwcm9iZXMgXHUyMDE0IG9uZSBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgKyBgZ2l0IHNwYW4gbGlzdFxuICogLS1wb3JjZWxhaW5gIHBhaXIgZm9yIHRoZSBkZWxldGUtcmVhbGl0eSBtZW1iZXJzaGlwLCBhbmQgb25lIGBnaXQgc3RhdHVzXG4gKiAtLXBvcmNlbGFpbmAgYmF0Y2ggZm9yIHRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggbWFyayBcdTIwMTQgbmV2ZXIgb25lXG4gKiBzdWJwcm9jZXNzIHBlciBwYXRoLCBtZW1iZXJzaGlwIGZyb20gcHJpbnRlZCByb3dzLiBUaGUgYHJ1bkJhc2hUb3VjaGVzYFxuICogZHJpdmVyIHNlZWRzIHRoZSBkZWxldGUtcmVhbGl0eSBoYWxmIHdpdGggZXZlcnkgYWJzZW50IHRhcmdldCBhbmRcbiAqIGNwL2luc3RhbGwgc291cmNlIG9mIHRoZSBjb21wb3VuZCBhbmQgdGhlIHN0YXR1cyBoYWxmIHdpdGggdGhlXG4gKiBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIGNhbmRpZGF0ZSBwYXRocywgYW5kIHNoYXJlcyB0aGUgY2FjaGUgaW50b1xuICogcGFzcyBCIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dCByZS1wcm9iaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgLyoqIERpc3RpbmN0IGFic29sdXRlIHBhdGhzIHRvIHByb2JlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLiAqL1xuICBwYXRoczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBhYnNvbHV0ZSBwYXRocyBjb25maXJtZWQgaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkLCBjb21wdXRlZCBvbmNlLiAqL1xuICByZWFsUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbiAgLyoqXG4gICAqIFRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzIHByb2JlIHNjb3BlIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZGlzdGluY3RcbiAgICogZGVsZXRlIHBhdGhzIGEgbGF0ZXIgY29tbWFuZCBvZiB0aGUgY29tcG91bmQgY2FuIHJlLWNyZWF0ZSB3aXRoIGFcbiAgICogZmlsZS1wcm9kdWNpbmcgd3JpdGUsIGluIGZpcnN0LXNlZW4gb3JkZXIuXG4gICAqL1xuICBjaGFuZ2VkQ2FuZGlkYXRlczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBjYW5kaWRhdGVzIGNhcnJ5aW5nIGFueSB0cmFja2VkIHN0YXR1cyByb3cgKGluZGV4IG9yIHdvcmt0cmVlIGNvbHVtbiksIGNvbXB1dGVkIG9uY2UuICovXG4gIGNoYW5nZWRQYXRoczogU2V0PHN0cmluZz4gfCBudWxsO1xufVxuXG4vKiogQ3JlYXRlIGEgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgZm9yIHRoZSBnaXZlbiBhYnNvbHV0ZSBwYXRocy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShcbiAgcGF0aHM6IEl0ZXJhYmxlPHN0cmluZz4sXG4gIGNoYW5nZWRDYW5kaWRhdGVzOiBJdGVyYWJsZTxzdHJpbmc+ID0gW11cbik6IFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgcmV0dXJuIHtcbiAgICBwYXRoczogWy4uLm5ldyBTZXQocGF0aHMpXSxcbiAgICByZWFsUGF0aHM6IG51bGwsXG4gICAgY2hhbmdlZENhbmRpZGF0ZXM6IFsuLi5uZXcgU2V0KGNoYW5nZWRDYW5kaWRhdGVzKV0sXG4gICAgY2hhbmdlZFBhdGhzOiBudWxsXG4gIH07XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGV4aXN0cyBvbiBkaXNrIChhbnkgbm9kZSBraW5kKTsgYGZhbHNlYCBvbiBhbnkgc3RhdCBmYWlsdXJlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVFeGlzdHMoYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZnMuc3RhdFN5bmMoYWJzUGF0aCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhIHJlZ3VsYXIgZmlsZSBcdTIwMTQgYSBkaXJlY3RvcnkgdGFyZ2V0IGZhaWxzIHRoZSBgJ2V4aXN0cydgIGdhdGUuICovXG5mdW5jdGlvbiBpc0ZpbGVPbkRpc2soYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGFic1BhdGgpLmlzRmlsZSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBWZXJpZnkgYSBzdGF0aWNhbGx5IGtub3dhYmxlIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBhZ2FpbnN0IHRoZSBvbi1kaXNrXG4gKiBmaWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIEFueSByZWFkIGZhaWx1cmUgaXMgYSBtaXNtYXRjaCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGNvbnRlbnRNYXRjaGVzKHBvc3Q6IFRvdWNoUG9zdENvbnRlbnQsIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBpZiAoJ2V4YWN0JyBpbiBwb3N0KSByZXR1cm4gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpID09PSBwb3N0LmV4YWN0O1xuICAgIGlmICgnc3VmZml4JyBpbiBwb3N0KSB7XG4gICAgICAvLyBUaGUgc2hlbGwgYXBwZW5kcyB0aGUgYm9keSBwbHVzIGl0cyB0ZXJtaW5hdGluZyBuZXdsaW5lOyB0aGUgaGVyZWRvY1xuICAgICAgLy8gZ3JhbW1hciBzdHJpcHMgZXhhY3RseSB0aGF0IG9uZSBgXFxuYCBmcm9tIGBzcGFuLndyaXR0ZW5gXG4gICAgICAvLyAocGFyc2UtY29tbWFuZC50cyBoZXJlZG9jIGJvZHkgZXh0cmFjdGlvbiksIHNvIGEgZmlsZSBlbmRpbmdcbiAgICAgIC8vIGB3cml0dGVuXFxuYCBpcyB0aGUgc2FtZSBhcHBlbmRlZCB0ZXh0IGFzIGB3cml0dGVuYCBcdTIwMTQgYWNjZXB0IGJvdGguXG4gICAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgcmV0dXJuIGNvbnRlbnQuZW5kc1dpdGgocG9zdC5zdWZmaXgpIHx8IGNvbnRlbnQuZW5kc1dpdGgoYCR7cG9zdC5zdWZmaXh9XFxuYCk7XG4gICAgfVxuICAgIGlmICgnZW1wdHknIGluIHBvc3QpIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gMDtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IHBvc3Quc2l6ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IGxhemlseSBydW4gdGhlIHR3byBwZXItY29tbWFuZFxuICogYmF0Y2hlcyBhbmQgY2FjaGUgdGhlIGNvbmZpcm1lZC1yZWFsIHBhdGggc2V0LiBNZW1iZXJzaGlwIGNvbWVzIGZyb20gdGhlXG4gKiBwcmludGVkIHJvd3MsIG5vdCB0aGUgZXhpdCBjb2RlIFx1MjAxNCBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgcHJpbnRzXG4gKiBldmVyeSB0cmFja2VkIHBhdGggZXZlbiB3aGVuIGl0IGV4aXRzIG5vbnplcm8gKGFueSBtaXNzaW5nIHBhdGgpLCBhbmRcbiAqIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCBwcmludHMgbm90aGluZyBmb3IgcGhhbnRvbSBvciBrbm93bi1idXQtXG4gKiB1bnNwYW5uZWQgcGF0aHMgKGV4aXQgMCB3aXRoIFwiTm8gc3BhbnMgbWF0Y2ggdGhlIGZpbHRlcnNcIikuIEEgcGxhaW4tYHJtYCdkXG4gKiB0cmFja2VkIGZpbGUga2VlcHMgaXRzIGluZGV4IGVudHJ5IChscy1maWxlcyBleGl0IDAgXHUyMDE0IHRoZSBwcm9iZSBmaXJlcyk7XG4gKiBgZ2l0IHJtYCByZW1vdmVzIGl0IChscy1maWxlcyAxMjgpIHNvIG9ubHkgc3Bhbm5lZCBmaWxlcyBzdGF5IHJlYWwuIEFcbiAqIHBoYW50b20gb3IgdW50cmFja2VkLXVuc3Bhbm5lZCBwYXRoIGZhaWxzIGJvdGggcHJvYmVzIFx1MjAxNCB0aGUgZGVsZXRlIGRlZ3JhZGVzXG4gKiB0byBgJ2luY29uY2x1c2l2ZSdgIGFuZCBuZXZlciBmaXJlcy4gRmFpbC1zYWZlOiBhbiB1bnJlc29sdmFibGUgcmVwbyBvciBhXG4gKiBwcm9iZSBmYWlsdXJlIHlpZWxkcyBhbiBlbXB0eSBzZXQsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWFsUGF0aHMoY2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgaWYgKGNhY2hlLnJlYWxQYXRocyAhPT0gbnVsbCkgcmV0dXJuIGNhY2hlLnJlYWxQYXRocztcbiAgY29uc3QgcmVhbCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBpZiAoY2FjaGUucGF0aHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgaWYgKHJlcG9Sb290ICE9PSBudWxsKSB7XG4gICAgICBjb25zdCByZWxzID0gY2FjaGUucGF0aHMubWFwKChwKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgcCkpO1xuICAgICAgY29uc3QgY2FwdHVyZSA9IChhcmdzOiBzdHJpbmdbXSk6IHN0cmluZyB8IG51bGwgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICAgIHJldHVybiB0eXBlb2Ygc3Rkb3V0ID09PSAnc3RyaW5nJyA/IHN0ZG91dCA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdCBsc0ZpbGVzID0gY2FwdHVyZShbJ2xzLWZpbGVzJywgJy0tZXJyb3ItdW5tYXRjaCcsICctLScsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChsc0ZpbGVzICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsc0ZpbGVzLnNwbGl0KCdcXG4nKSkge1xuICAgICAgICAgIGNvbnN0IHJlbCA9IGxpbmUudHJpbSgpO1xuICAgICAgICAgIGlmIChyZWwubGVuZ3RoID4gMCkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcmVsKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwYW5MaXN0ID0gY2FwdHVyZShbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChzcGFuTGlzdCAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiBwYXJzZVBvcmNlbGFpbihzcGFuTGlzdCkpIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJvdy5wYXRoKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNhY2hlLnJlYWxQYXRocyA9IHJlYWw7XG4gIHJldHVybiByZWFsO1xufVxuXG4vKipcbiAqIFRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDIsIHJvdW5kLTM7IHdpZGVuZWQgcm91bmQtNCk6XG4gKiBsYXppbHkgcnVuIG9uZSBgZ2l0IHN0YXR1cyAtLXBvcmNlbGFpbiAtemAgYmF0Y2ggb3ZlciB0aGUgc2VlZGVkIGNhbmRpZGF0ZXNcbiAqIGFuZCBjYWNoZSB0aGUgc2V0IGNhcnJ5aW5nIGFueSB0cmFja2VkIHN0YXR1cyByb3cgXHUyMDE0IHRoZSByZS1jcmVhdGUncyBtYXJrLlxuICogVGhlIGRyaXZlciBjb25zdWx0cyBpdCBiZWZvcmUgZXhwbGFpbmluZyBhIGRlbGV0ZSdzIGRlY2lzaXZlRmFpbCAoXCJmaWxlXG4gKiBwcmVzZW50LCBzbyB0aGUgZGVsZXRlIGRpZG4ndCBoYXBwZW5cIikgYnkgYSBsYXRlciBzYW1lLXBhdGggd3JpdGU7IGFcbiAqIGRlY2lzaXZlRmFpbCBpbXBsaWVzIHRoZSBwYXRoIEVYSVNUUyBhdCBjb21wb3VuZCBlbmQsIHNvIGV2ZXJ5IHJvdyBzaGFwZVxuICogYmVsb3cgaXMganVkZ2VkIGFnYWluc3QgdGhhdCByZWFsaXR5LlxuICpcbiAqIFJvdW5kLTMgcmVhZCBvbmx5IHRoZSBZICh3b3JrdHJlZSkgY29sdW1uLCB0cmVhdGluZyBcIndvcmtpbmcgdHJlZSA9PVxuICogaW5kZXhcIiBhcyBwcm9vZiB0aGUgcmUtY3JlYXRlIHdyaXRlIG5ldmVyIHJhbi4gVGhhdCBwcm9iZSBzdGF0ZSBpcyBzaGFyZWRcbiAqIGJ5IHR3byByZWFsaXRpZXMgdGhlIHJ1bGUgY29uZmxhdGVkOiAoYSkgdGhlIHdyaXRlIGdlbnVpbmVseSBuZXZlciByYW4gXHUyMDE0XG4gKiBhIGZhaWxlZCBybSBzaG9ydC1jaXJjdWl0cyB0aGUgYCYmYCBjaGFpbiwgdGhlIGZpbGUgc3RpbGwgbWF0Y2hlcyBIRUFEIGFuZFxuICogdGhlIGluZGV4LCBhbmQgTk8gcm93IGV4aXN0cyBcdTIwMTQgYW5kIChiKSB0aGUgd3JpdGUgcmFuIEFORCB3YXMgc3RhZ2VkIGluIHRoZVxuICogc2FtZSBjb21wb3VuZCAoYHJtIGYgJiYgcGF0Y2ggPCBkICYmIGdpdCBhZGQgZmAgXHUyMTkyIGBNIGAgcm93LCBibGFuayBZKTogdGhlXG4gKiByb3VuZC00IGZpbmRpbmcsIGEgdmVyaWZpZWQgd3JpdGUgbGVmdCBzaWxlbnQuIFRoZSBydWxlIG5vdyBtYXJrcyBBTllcbiAqIHRyYWNrZWQgc3RhdHVzIHJvdzogdGhlIFggKGluZGV4KSBjb2x1bW4gb3IgdGhlIFkgKHdvcmt0cmVlKSBjb2x1bW5cbiAqIG5vbi1ibGFuay4gYC0tdW50cmFja2VkLWZpbGVzPW5vYCBzdXBwcmVzc2VzIGA/PyBgIHJvd3MsIGFuZCBgP2AvYCFgIGFyZVxuICogcmVqZWN0ZWQgZGVmZW5zaXZlbHkgXHUyMDE0IGFuIHVudHJhY2tlZCBvciBpZ25vcmVkIHBhdGggY2FycmllcyBubyBpbmRleFxuICogYmFzZWxpbmUsIHNvIGl0IGNhbiBuZXZlciBjb3VudCBhcyByZS1jcmVhdGVkIChmYWlsIGNsb3NlZCkuXG4gKlxuICogUGVyLWNvbHVtbiByZWFzb25pbmcgYWdhaW5zdCB0aGUgZGVsZXRlLXNwYW4gcmVhbGl0eSAodGhlIHBhdGggaXMgdHJhY2tlZFxuICogaW4gdGhlIGluZGV4IHBlciB0aGUgZGVsZXRlLXJlYWxpdHkgcHJvYmUsIGFuZCBleGlzdHMgYXQgY29tcG91bmQgZW5kKTpcbiAqIC0gYE0gYCAvIGBBIGAgKGluZGV4IGRpZmZlcnMgZnJvbSBIRUFELCB3b3JrdHJlZSBtYXRjaGVzIHRoZSBpbmRleCk6IHRoZVxuICogICBjb21wb3VuZCBzdGFnZWQgYSB3cml0ZSAoYGdpdCBhZGRgOyBgQSBgIHdoZW4gdGhlIHBhdGgncyBiYXNlbGluZSB3YXNcbiAqICAgaXRzZWxmIGEgc3RhZ2VkIGFkZCwgc28gbmV2ZXIgaW4gSEVBRCkgXHUyMDE0IGNhc2UgKGIpLCB0aGUgcmUtY3JlYXRlIGlzXG4gKiAgIHZlcmlmaWVkIHJlYWwgaW4gdGhlIGluZGV4LlxuICogLSBgUiBgIChhIHN0YWdlZCByZW5hbWUgd2hvc2UgZGVzdGluYXRpb24gaXMgdGhlIHBhdGgpOiBzYW1lIFx1MjAxNCB0aGUgaW5kZXhcbiAqICAgcmVjb3JkcyB0aGUgd3JpdGUuXG4gKiAtIGBEIGAgKGluZGV4IGRlbGV0ZWQsIHdvcmt0cmVlIG1hdGNoZXMpOiB0aGUgZmlsZSBpcyBlaXRoZXIgYWJzZW50XG4gKiAgIChtYXRjaGluZyB0aGUgc3RhZ2VkIGRlbGV0ZSBcdTIwMTQgbm8gZGVjaXNpdmVGYWlsLCB0aGUgYXhpcyBpcyBuZXZlclxuICogICBjb25zdWx0ZWQpIG9yIHJlY3JlYXRlZC1idXQtdW50cmFja2VkIGFmdGVyIGEgYGdpdCBybWAgKGhpZGRlbiBieVxuICogICBgLS11bnRyYWNrZWQtZmlsZXM9bm9gLCB0aGUgcm93IHBlcnNpc3RzKSBcdTIwMTQgYSBwcmVzZW50IGZpbGUgbWVhbnMgdGhlXG4gKiAgIGNvbXBvdW5kIHdyb3RlIGl0LCBzbyBpdCBjb3VudHMuXG4gKiAtIFktY29sdW1uIHJvd3MgKGAgTWAsIGBNTWAsIGAgRGAsIGBBTWAuLi4pOiB0aGUgcm91bmQtMyBydWxlIHVuY2hhbmdlZCBcdTIwMTRcbiAqICAgdGhlIHdvcmt0cmVlIGRlbW9uc3RyYWJseSBkaWZmZXJzIGZyb20gdGhlIGluZGV4LlxuICpcbiAqIENhc2UgKGEpIHN0aWxsIHlpZWxkcyBOTyByb3cgKHRoZSBmaWxlIG1hdGNoZXMgSEVBRCBcdTIwMTQgdGhlIGNoYWluXG4gKiBzaG9ydC1jaXJjdWl0ZWQgYmVmb3JlIGFueXRoaW5nIGNoYW5nZWQpLCBzbyB0aGUgZ2VudWluZSBzdXBwcmVzc2lvbiBob2xkcy5cbiAqIFRoZSBvbmUgcmVzaWR1YWwgY2xhc3MgKGRvY3VtZW50ZWQgaW4gdGhlIGF4aXMncyBjYWxsIHNpdGUpOiBhIFBSRS1FWElTVElOR1xuICogdW5jb21taXR0ZWQgb3Igc3RhZ2VkIGNoYW5nZSBvbiB0aGUgZGVsZXRlZCBwYXRoIG1hc2tzIHRoZSBkaXNjcmltaW5hdG9yIFx1MjAxNFxuICogdGhlIHN0YXR1cyByb3cgcHJlZGF0ZXMgdGhlIGNvbXBvdW5kLCBzbyBhIGZhaWxlZCBybSBsZXRzIHRoZSBqb2luZWQgd3JpdGVcbiAqIGZpcmUgYWR2aXNvcnkuIFRoZSBzdGFnZWQgZmFjZSBpcyB0aGUgd2lkZW5pbmcncyBvbmUgY29zdDogcm91bmQtMydzXG4gKiBibGFuay1ZIHJ1bGUga2VwdCBgTSBgL2BBIGAgcm93cyBpbnZpc2libGUsIHNvIG9ubHkgdGhlIHdvcmt0cmVlLWRpcnR5XG4gKiBtYXNrIGZpcmVkOyB0aGUgaW5kZXggY29sdW1uIG5vdyBtYXJrcyBib3RoLiBJdCBvbmx5IG1hbmlmZXN0cyB3aGVyZVxuICogZ2VudWluZSBkcmlmdCBleGlzdHMgYWdhaW5zdCB0aGUgc3BhbiBiYXNlbGluZSwgYW5kIGEgaGFybmVzcy1zdXBwbGllZFxuICogbm9uLXplcm8gZXhpdCBjb2RlIHN0aWxsIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5IGNsYXNzIGluIHBhc3MgQiBcdTIwMTQgdGhlXG4gKiBzYW1lIGJvdW5kZWQgaGFybSBhcyB0aGUgcGxhbidzIGRvY3VtZW50ZWQgXCJjb2luY2lkZW50YWxseSBwYXNzZXNcIiBqb2luXG4gKiBjb3JuZXIuIGAtemAgcHJpbnRzIHJhdywgTlVMLXNlcGFyYXRlZCBgWFkgPHBhdGg+YCBlbnRyaWVzIHNvIHNwYWNlLSBhbmRcbiAqIHF1b3RlLWJlYXJpbmcgcGF0aHMgcGFyc2UgdW5hbWJpZ3VvdXNseS4gRmFpbC1zYWZlOiBhbiB1bnJlc29sdmFibGUgcmVwb1xuICogb3IgYSBwcm9iZSBmYWlsdXJlIHlpZWxkcyBhbiBlbXB0eSBzZXQsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiBjaGFuZ2VkT25EaXNrKGNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gIGlmIChjYWNoZS5jaGFuZ2VkUGF0aHMgIT09IG51bGwpIHJldHVybiBjYWNoZS5jaGFuZ2VkUGF0aHM7XG4gIGNvbnN0IGNoYW5nZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgaWYgKGNhY2hlLmNoYW5nZWRDYW5kaWRhdGVzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGlmIChyZXBvUm9vdCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVscyA9IGNhY2hlLmNoYW5nZWRDYW5kaWRhdGVzLm1hcCgocCkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIHApKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLXonLCAnLS11bnRyYWNrZWQtZmlsZXM9bm8nLCAnLS0nLCAuLi5yZWxzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgICAgIH0pO1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG91dC5zcGxpdCgnXFwwJykpIHtcbiAgICAgICAgICBpZiAoZW50cnkubGVuZ3RoIDwgNCkgY29udGludWU7IC8vIHNraXAgdGhlIHRyYWlsaW5nIGVtcHR5IGVudHJ5IGFuZCByZW5hbWUtcGFpciBwYXRoIHJvd3NcbiAgICAgICAgICBjb25zdCBpbmRleFN0YXR1cyA9IGVudHJ5LmNoYXJBdCgwKTtcbiAgICAgICAgICBjb25zdCB3b3JrdHJlZVN0YXR1cyA9IGVudHJ5LmNoYXJBdCgxKTtcbiAgICAgICAgICBpZiAoaW5kZXhTdGF0dXMgPT09ICcgJyAmJiB3b3JrdHJlZVN0YXR1cyA9PT0gJyAnKSBjb250aW51ZTsgLy8gbm8gdHJhY2tlZCBkaWZmZXJlbmNlIFx1MjE5MiBubyBtYXJrXG4gICAgICAgICAgaWYgKGluZGV4U3RhdHVzID09PSAnPycgfHwgaW5kZXhTdGF0dXMgPT09ICchJyB8fCB3b3JrdHJlZVN0YXR1cyA9PT0gJz8nIHx8IHdvcmt0cmVlU3RhdHVzID09PSAnIScpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlOyAvLyB1bnRyYWNrZWQgb3IgaWdub3JlZCBcdTIxOTIgbm8gaW5kZXggYmFzZWxpbmUgKGZhaWwgY2xvc2VkKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjaGFuZ2VkLmFkZChqb2luKHJlcG9Sb290LCBlbnRyeS5zbGljZSgzKSkpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgdm9pZCBlcnI7IC8vIHByb2JlIGZhaWx1cmUgXHUyMTkyIGVtcHR5IHNldCAoZmFpbC1zYWZlLCBuZXZlciBhbiBlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY2FjaGUuY2hhbmdlZFBhdGhzID0gY2hhbmdlZDtcbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgcGF0aCBjYXJyaWVzIGEgdHJhY2tlZCBzdGF0dXMgcm93IFx1MjAxNCBpdHMgaW5kZXggY29udGVudCwgaXRzXG4gKiB3b3JraW5nLXRyZWUgY29udGVudCwgb3IgYm90aCBkaWZmZXIgZnJvbSB0aGUgY29tbWl0dGVkL2luZGV4IGJhc2VsaW5lXG4gKiAoc2VlIHRoZSBwcm9iZSdzIHBlci1jb2x1bW4gcmVhc29uaW5nKSBcdTIwMTQgdGhlIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uJ3NcbiAqIG1hcmsuIGBmYWxzZWAgb24gYW55IHByb2JlIGZhaWx1cmUgb3IgZm9yIGFueSBwYXRoIG91dHNpZGUgdGhlIHNlZWRlZFxuICogY2FuZGlkYXRlcyAoZmFpbCBjbG9zZWQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd29ya2luZ1RyZWVDaGFuZ2VkKHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBjaGFuZ2VkT25EaXNrKHByb2JlQ2FjaGUsIGN3ZCkuaGFzKGFic1BhdGgpO1xufVxuXG4vKipcbiAqIFRoZSBsYXllcmVkIHBvc3Qtc3RhdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSksIGV2YWx1YXRlZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gKiBjYWxsLCBzaWRlLWVmZmVjdC1mcmVlIChubyBtZW1vIHdyaXRlcywgbm8gZXhlY3V0b3IgY2FsbHM7IHRoZSBwcm9iZSBpc1xuICogcmVhZC1vbmx5IGFuZCBwZXItY29tbWFuZCBjYWNoZWQpOlxuICpcbiAqIDEuIGB0YXJnZXRTdGF0ZTogJ2Fic2VudCdgIFx1MjE5MiB0aGUgcGF0aCBtdXN0IGJlIGFic2VudDsgd2hlbiBpdCBpcywgdGhlXG4gKiAgICBkZWxldGUtcmVhbGl0eSBwcm9iZSBkZWNpZGVzOiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgXHUyMTkyIGBkZWNpc2l2ZVBhc3NgXG4gKiAgICAoZGFuZ2xpbmcgYW5jaG9ycyBzdXJmYWNlKSwgcGhhbnRvbSBcdTIxOTIgYCdpbmNvbmNsdXNpdmUnYCAobm90aGluZyB0b1xuICogICAgc3VyZmFjZSBcdTIwMTQgdGhlIG1pc3MgaXMgaGFybWxlc3MsIGFuZCB0aGUgZGVsZXRlIG5ldmVyIGZpcmVzKS5cbiAqIDIuIGB0YXJnZXRTdGF0ZTogJ2V4aXN0cydgIFx1MjE5MiB0aGUgdGFyZ2V0IG11c3QgYmUgYSByZWd1bGFyIGZpbGUgKGEgZGlyZWN0b3J5XG4gKiAgICBvciBtaXNzaW5nIHRhcmdldCBmYWlscykuXG4gKiAzLiBDb250ZW50IHZlcmlmaWNhdGlvbiB3aGVyZSB0aGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IGlzIHN0YXRpY2FsbHlcbiAqICAgIGtub3dhYmxlIChgZXhhY3RgL2BzdWZmaXhgL2BlbXB0eWAvYHNpemVgKTogYSBtaXNtYXRjaCBtZWFucyB0aGUgd3JpdGUnc1xuICogICAgZWZmZWN0IGlzIGFic2VudCBcdTIwMTQgbm8gdG91Y2guXG4gKiA0LiBjcCBkZXN0aW5hdGlvbi12cy1zb3VyY2U6IGEgc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZVxuICogICAgZGVzdGluYXRpb247IGFuIGFic2VudCBzb3VyY2UgYXBwbGllcyB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwYXNzZWQgdGhlXG4gKiAgICByZWFsaXR5IHByb2JlIEFORCBpdHMgYWJzZW5jZSBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGhcbiAqICAgIGBkZWNpc2l2ZVBhc3NgIFx1MjAxNCB0aGUgZHJpdmVyIHJlc29sdmVzIHRoZSBgJ3BlbmRpbmcnYCBob2xkKS5cbiAqIDUuIHJlbmFtZS1jb3B5OiB0aGUgZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgKGEgcGhhbnRvbSBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkKS5cbiAqXG4gKiBFdmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nIFx1MjAxNCBpcyBgJ2luY29uY2x1c2l2ZSdgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQ6IFRvdWNoV3JpdGVJbnB1dCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50Jykge1xuICAgIGlmIChmaWxlRXhpc3RzKGlucHV0LmZpbGVQYXRoKSkgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuZmlsZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnaW5jb25jbHVzaXZlJztcbiAgfVxuXG4gIGlmICghaXNGaWxlT25EaXNrKGlucHV0LmZpbGVQYXRoKSkgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuXG4gIGNvbnN0IGNvbnRlbnQgPSBpbnB1dC5wb3N0U3RhdGU/LmNvbnRlbnQ7XG4gIGlmIChjb250ZW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gY29udGVudE1hdGNoZXMoY29udGVudCwgaW5wdXQuZmlsZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5zb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5zb3VyY2VQYXRoKSkge1xuICAgICAgbGV0IHNyYzogc3RyaW5nO1xuICAgICAgbGV0IGRzdDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc3JjID0gZnMucmVhZEZpbGVTeW5jKGlucHV0LnNvdXJjZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgIGRzdCA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5maWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3JjID09PSBkc3QgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgIH1cbiAgICAvLyBBYnNlbnQgc291cmNlIFx1MjAxNCB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IHRoZSBkZXN0XG4gICAgLy8gZmlyZXMgb25seSB3aGVuIHRoZSBzb3VyY2UgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIChpdCB3YXMgYSByZWFsXG4gICAgLy8gZmlsZSkgQU5EIGl0cyBhYnNlbmNlIGlzIGV4cGxhaW5lZCBieSBhIGxhdGVyIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5zb3VyY2VQYXRoKSA/ICdwZW5kaW5nJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgaWYgKGlucHV0LnJlbmFtZVNvdXJjZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgIC8vIE5vIGNvbnRlbnQgY29tcGFyaXNvbiBcdTIwMTQgcGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQ7IGEgcGhhbnRvbVxuICAgIC8vIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhcyBuZXZlclxuICAgIC8vIHRvdWNoZWQgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKS5cbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LnJlbmFtZVNvdXJjZVBhdGgpID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIHJldHVybiAnaW5jb25jbHVzaXZlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbmplY3RlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3RydWN0dXJlZCByZXN1bHQgb2YgYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRml4UmVzdWx0IHtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYC0tZml4YCByZS1hbmNob3JlZCBhdCBsZWFzdCBvbmUgc3BhbiBpbiB0aGUgd29ya2luZyB0cmVlLiBEcml2ZXNcbiAgICoge0BsaW5rIFRvdWNoT3V0cHV0LnRyZWVNb2RpZmllZH0gc28gYSBjYWxsZXIvdGVzdCBjYW4gYXNzZXJ0IHRoZSBoZWFsaW5nXG4gICAqIGhhcHBlbmVkIHdpdGhvdXQgZGlmZmluZyB0aGUgdHJlZSBpdHNlbGYuXG4gICAqL1xuICBtb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGAgc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgKHdyaXRlIHBhdGhcbiAqIG9ubHkpLCByZXBvcnRpbmcgd2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBoZWFsZWQuIEFzeW5jIHNvIHRoZSBldmVudHVhbFxuICogaW1wbGVtZW50YXRpb24gYW5kIGl0cyB0ZXN0cyBjYW4gaW5qZWN0IGEgZmFrZSB3aXRob3V0IGEgcmVhbCBzdWJwcm9jZXNzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEZpeEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFRvdWNoRml4UmVzdWx0PjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPGZpbGU+YCBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlclxuICogYW5jaG9yIGNvdmVyaW5nIHRoZSBmaWxlLiBTdHJ1Y3R1cmVkIChub3QgcmF3IHN0ZG91dCkgc28gdGhlIG1lcmdlZC1ibG9ja1xuICogY29tcHV0YXRpb24gYW5kIGl0cyB0ZXN0cyBzaGFyZSB0aGUgc2FtZSBzaGFwZS5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hMaXN0RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxhcmdzPmAgKHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIG9yXG4gKiBpdHMgc3BhbnMpIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yLCBlbXB0eSB3aGVuXG4gKiBjbGVhbi4gU3RhdHVzIGNsYXNzaWZpY2F0aW9uIGlzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsIChgTU9WRURgLFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hEcmlmdEV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxEcmlmdFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYmFyZSBgZ2l0IHNwYW4gd2h5IDxuYW1lPmAgYW5kIHJldHVybiB0aGUgc3BhbidzIHJlY29yZGVkIHdoeSBzZW50ZW5jZSxcbiAqIG9yIGBudWxsYCB3aGVuIG5vbmUgaXMgcmVjb3JkZWQgb3IgdGhlIHJlYWQgZmFpbHMuIEZlZWRzIHRoZSBodW1hbi1mb3JtYXRcbiAqIHNwYW4gcmVuZGVyOyBpbnZva2VkIG9ubHkgZm9yIHNwYW5zIGFjdHVhbGx5IGJlaW5nIHN1cmZhY2VkIHRoaXMgdG91Y2guXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoV2h5RXhlY3V0b3IgPSAobmFtZTogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPjtcblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UuIEtlcHQgYXMgZm91ciBuYXJyb3cgYXN5bmMgZnVuY3Rpb25zIChyYXRoZXJcbiAqIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIHNvIHRlc3RzIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhXG4gKiBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2VzcyBpdHNlbGYuIFRoZSBgcmVhZGAgcGF0aCBuZXZlciBpbnZva2VzXG4gKiBgZml4YC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEV4ZWN1dG9ycyB7XG4gIGZpeDogVG91Y2hGaXhFeGVjdXRvcjtcbiAgbGlzdDogVG91Y2hMaXN0RXhlY3V0b3I7XG4gIGRyaWZ0OiBUb3VjaERyaWZ0RXhlY3V0b3I7XG4gIHdoeTogVG91Y2hXaHlFeGVjdXRvcjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBvdXRwdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hhdCB0aGUgY29yZSBoYW5kcyBiYWNrIGZvciB0aGUgYWRhcHRlciB0byB0cmFuc2xhdGUgaW50byBTREsgb3V0cHV0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaE91dHB1dCB7XG4gIC8qKlxuICAgKiBUaGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayAoaGVhZGVyLCBvbmUgaHVtYW4tZm9ybWF0IHNlY3Rpb24gcGVyXG4gICAqIHN1cmZhY2VkIHNwYW4sIGZvb3RlcikgdG8gaW5qZWN0IHZpYSB0aGUgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsXG4gICAqIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgd29ydGggc3VyZmFjaW5nIHRoaXMgdG91Y2guXG4gICAqL1xuICBhZGRpdGlvbmFsQ29udGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgbW9kaWZpZWQgYnkgYSBzY29wZWQgYC0tZml4YCBvbiB0aGUgd3JpdGUgcGF0aC5cbiAgICogQWx3YXlzIGBmYWxzZWAgb24gdGhlIHJlYWQgcGF0aCAocmVhZHMgbmV2ZXIgbXV0YXRlIHRoZSB0cmVlKS5cbiAgICovXG4gIHRyZWVNb2RpZmllZDogYm9vbGVhbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNZXJnZWQtYmxvY2sgYXNzZW1ibHlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIG1lbW8ga2V5IHVuZGVyIHdoaWNoIGEgc3BhbidzIHJlbmRlciBmb3IgYSBnaXZlbiBkcmlmdCBzdGF0dXMgaXMgZGVkdXBlZC4gKi9cbmZ1bmN0aW9uIGRyaWZ0S2V5KG5hbWU6IHN0cmluZywgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICAvLyBTcGFuIG5hbWVzIGNvbWUgZnJvbSB0YWItZGVsaW1pdGVkIHBvcmNlbGFpbiwgc28gdGhleSBuZXZlciBjb250YWluIGEgdGFiO1xuICAvLyBhIHRhYi1qb2luZWQga2V5IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYSBiYXJlIHNwYW4gbmFtZSAodGhlIHN1cmZhY2luZyBrZXkpLlxuICByZXR1cm4gYCR7bmFtZX1cXHQke3N0YXR1c31gO1xufVxuXG4vKiogVGhlIGBwYXRoI0xzdGFydC1MZW5kYCAob3IgYmFyZS1wYXRoLCB3aG9sZS1maWxlKSBhbmNob3IgdGV4dCBmb3IgYSByb3cuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuSGVhZGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7ZmlsZU5hbWV9IGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXM6YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5Gb290ZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgSWYgeW91IGNoYW5nZSAke2ZpbGVOYW1lfSBjaGVjayB0aGUgb3RoZXIgZmlsZXMgdG8gY29uZmlybSB0aGV5IHN0aWxsIHdvcmsgdG9nZXRoZXIuYDtcbn1cblxuLyoqXG4gKiBUaGUgd3JpdGUgcGF0aCBuYW1lcyB0aGUgZWRpdCBhcyB0aGUgY2F1c2U7IHRoZSByZWFkIHBhdGggb25seSBzdXJmYWNlc1xuICogcHJlLWV4aXN0aW5nIGRyaWZ0IGl0IGRpZG4ndCBjcmVhdGUsIHNvIGl0IG5hbWVzIHRoZSBkZXBlbmRlbmN5IGluc3RlYWQuXG4gKi9cbmZ1bmN0aW9uIGRyaWZ0SGVhZGVyKGRyaWZ0ZWRDb3VudDogbnVtYmVyLCBraW5kOiBUb3VjaElucHV0WydraW5kJ10pOiBzdHJpbmcge1xuICBpZiAoa2luZCA9PT0gJ3dyaXRlJykge1xuICAgIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICAgID8gJ1RoaXMgZWRpdCBwdXQgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgICA6ICdUaGlzIGVkaXQgcHV0IGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xuICB9XG4gIHJldHVybiBkcmlmdGVkQ291bnQgPT09IDFcbiAgICA/ICdUaGlzIGZpbGUgaGFzIGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgIDogJ1RoaXMgZmlsZSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG59XG5cbmZ1bmN0aW9uIGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lczogc3RyaW5nW10pOiBzdHJpbmcge1xuICBpZiAoZHJpZnRlZE5hbWVzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IG5hbWUgPSBkcmlmdGVkTmFtZXNbMF07XG4gICAgcmV0dXJuIGBSZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIFxcYGdpdCBzcGFuIHJlcGxhY2VcXGAuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCBzd2FwIHRoZSBvbGQgYW5jaG9yIGZvciB0aGUgbmV3IG9uZSB3aXRoIGBnaXQgc3BhbiByZXBsYWNlYC4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX0gKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHJ1bnMgZmlyc3QgXHUyMDE0XG4gKiAgIGFueSBkZWNpc2l2ZSBmYWlsLCBvciBhbiBpbmNvbmNsdXNpdmUgcGhhbnRvbSBkZWxldGUsIGJsb2NrcyB0aGUgdG91Y2hcbiAqICAgd2l0aCBubyBleGVjdXRvciBjYWxsIFx1MjAxNCB0aGVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPlxuICogICAtLWZpeGApIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmdcbiAqICAgdHJlZSwgYW5kIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGlzIGNvbXB1dGVkIGFnYWluc3QgdGhlIGhlYWxlZFxuICogICBhbmNob3JzLCByZW5kZXJpbmcgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoXG4gKiAgIGFueSByZW1haW5pbmcgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzXG4gKiAgIGRlZHVwZWQgdGhyb3VnaCBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIFRoZSBvcHRpb25hbCBgcHJvYmVDYWNoZWAgc2hhcmVzIHRoZSBkcml2ZXIncyBwZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eVxuICogcHJvYmUgaW50byBwYXNzIEIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dFxuICogcmUtcHJvYmluZzsgZGlyZWN0IGNhbGxlcnMgZ2V0IGEgcGVyLWNhbGwgY2FjaGUgc2VlZGVkIHdpdGggdGhlIHRvdWNoZWRcbiAqIHBhdGggd2hlbiB0aGUgdGFyZ2V0IGlzIGAnYWJzZW50J2AuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcHJvYmVDYWNoZT86IFJlYWxpdHlQcm9iZUNhY2hlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgcHJvYmUgPSBwcm9iZUNhY2hlID8/IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JyA/IFtpbnB1dC5maWxlUGF0aF0gOiBbXSk7XG4gICAgICBjb25zdCBvdXRjb21lID0gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQsIHByb2JlKTtcbiAgICAgIGlmIChvdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyB8fCAob3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSkge1xuICAgICAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gaW5wdXQucmFuZ2UgPz8gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZywgYW5kXG4gICAgICAgIC8vIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgQmFzaCBzcGFuIFx1MjE5MiB0b3VjaCB0cmFuc2xhdGlvbiBhbmQgdGhlIGpvaW4tZ2F0aW5nIGRyaXZlciAocGxhbiBcdTAwQTcyLFxuICogXHUwMEE3MyBzdGVwIDIpLiBCb3RoIGFkYXB0ZXJzIGNvbnN1bWUgdGhpcyBtb2R1bGUgb25jZSB0aGVpciBkdXBsaWNhdGUgQmFzaFxuICogc3BhbiBsb29wcyBjb2xsYXBzZTogaXQgb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0IHBhc3MgQVxuICogYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCwgdGhlIGV4cGxhbmF0aW9uIG1hcCwgdGhlIGpvaW4gZmlsdGVyLCBhbmQgcGFzcyBCXG4gKiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmQgYGludGVycnVwdGVkYFxuICogZ2F0ZSAocGxhbiBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiwgU3Bhbk1hdGNoIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHR5cGUgTWVtb1N0b3JlLCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlLFxuICBldmFsdWF0ZVdyaXRlR2F0ZSxcbiAgZmlsZUV4aXN0cyxcbiAgdHlwZSBSZWFsaXR5UHJvYmVDYWNoZSxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXQsXG4gIHR5cGUgV3JpdGVHYXRlT3V0Y29tZSxcbiAgd29ya2luZ1RyZWVDaGFuZ2VkXG59IGZyb20gJy4vdG91Y2gtY29yZS5qcyc7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSByZXNvbHZlZCBzcGFuIGludG8gYSBmdWxseS10eXBlZCB7QGxpbmsgVG91Y2hJbnB1dH0gcGVyIHRoZVxuICogcGxhbiBcdTAwQTcyIHRhYmxlLCBvciBgbnVsbGAgd2hlbiB0aGUgcGF0aCBmYWlscyBgcmVzb2x2ZVRvdWNoU2NvcGVgIFx1MjAxNCBjcm9zcy1cbiAqIHJlcG8sIGdpdGlnbm9yZWQsIGFuZCBzcGFuLWRvY3VtZW50IHBhdGhzIGZhaWwgY2xvc2VkLlxuICpcbiAqIFRoZSBwb3N0LXN0YXRlIGdhdGUgZmllbGRzIHRoZSBzcGFuIGNhbiBkZXRlcm1pbmUgKGB0YXJnZXRTdGF0ZWAsIGFuZFxuICogYHBvc3RTdGF0ZWAgZm9yIGFwcGVuZHMgYW5kIGRlbGV0ZXMpIGFyZSBzZXQgaGVyZTsgYSBsaXRlcmFsIG92ZXJ3cml0ZSBib2R5XG4gKiAoYHNwYW4ud3JpdHRlbmAgXHUyMDE0IHRoZSBmbGFnLWxlc3MgYGVjaG9gL2BwcmludGZgIGA+YCBjYXNlKSByaWRlcyBhcyB0aGVcbiAqIGBleGFjdGAgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdFxuICogd2hpbGUgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIFRydW5jYXRlcyBtYXBcbiAqIHRoZSBzcGFuJ3Mgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIHRvIHRoZSBgc2l6ZWAgcG9zdC1jb250ZW50XG4gKiAoYC1zIDBgIFx1MjE5MiBgZW1wdHlgKTsgYSB0cnVuY2F0ZSB3aXRob3V0IGEgc2l6ZSBnYXRlcyBleGlzdGVuY2Utb25seS4gVGhlXG4gKiBkcml2ZXIgcGFpcnMgY3AvaW5zdGFsbCBhbmQgbXYgc291cmNlcyBvbnRvIHRoZSBkZXN0aW5hdGlvbiB0b3VjaGVzXG4gKiBhZnRlcndhcmQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoU3BhblRvVG91Y2goc3BhbjogUmVzb2x2ZWRTcGFuLCBzZXNzaW9uSWQ6IHN0cmluZywgY3dkOiBzdHJpbmcpOiBUb3VjaElucHV0IHwgbnVsbCB7XG4gIGlmICghcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBzcGFuLmFic29sdXRlUGF0aCkpIHJldHVybiBudWxsO1xuICBzd2l0Y2ggKHNwYW4ub3BlcmF0aW9uKSB7XG4gICAgY2FzZSAncmVhZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgIGxpbWl0OlxuICAgICAgICAgIHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgJiYgc3Bhbi5saW5lRW5kICE9PSB1bmRlZmluZWQgPyBzcGFuLmxpbmVFbmQgLSBzcGFuLmxpbmVTdGFydCArIDEgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnY3JlYXRlLW92ZXJ3cml0ZSc6XG4gICAgY2FzZSAncmVuYW1lLWNvcHknOlxuICAgICAgLy8gV2hvbGUtZmlsZSB3cml0ZXM6IGB3cml0dGVuOiAnJ2Agc2NvcGVzIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZ1xuICAgICAgLy8gc3BhbiBcdTIwMTQgdHJ1bmNhdGluZyB3cml0ZXMgZGVzdHJveSBhbmNob3JzIGJleW9uZCB0aGUgbmV3IEVPRiAodGhlXG4gICAgICAvLyBtYWluLTIwMCBGMiBsZXNzb24pLiBBIGxpdGVyYWwgYm9keSByaWRlcyBhcyB0aGUgZXhhY3QgcG9zdC1jb250ZW50XG4gICAgICAvLyBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3QuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IGV4YWN0OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ3RydW5jYXRlJzpcbiAgICAgIC8vIFNhbWUgd2hvbGUtZmlsZSBzY29wZTsgdGhlIHNpemUgZ2F0ZSAocGxhbiBcdTAwQTcyLCBcdTAwQTczIHN0ZXAgMWIpIHZlcmlmaWVzXG4gICAgICAvLyB0aGUgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQgd2hlbiB0aGUgc3BhbiBjYXJyaWVzIGEgc3RhdGljYWxseVxuICAgICAgLy8gZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCAoYC1zIDBgIFx1MjE5MiBlbXB0eSk7IHdpdGhvdXQgb25lIHRoZSBnYXRlIGlzXG4gICAgICAvLyBleGlzdGVuY2Utb25seS5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTpcbiAgICAgICAgICBzcGFuLnNpemUgPT09IDBcbiAgICAgICAgICAgID8geyBjb250ZW50OiB7IGVtcHR5OiB0cnVlIH0gfVxuICAgICAgICAgICAgOiBzcGFuLnNpemUgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgICA/IHsgY29udGVudDogeyBzaXplOiBzcGFuLnNpemUgfSB9XG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2FwcGVuZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiBzcGFuLndyaXR0ZW4gPz8gJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBzdWZmaXg6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnbW9kaWZ5JzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHJhbmdlOiBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBzdGFydDogc3Bhbi5saW5lU3RhcnQsIGVuZDogc3Bhbi5saW5lRW5kID8/IHNwYW4ubGluZVN0YXJ0IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2Fic2VudCcsXG4gICAgICAgIHBvc3RTdGF0ZTogeyByZWFsRGVsZXRlOiB0cnVlIH1cbiAgICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBCYXNoIGB0b29sX3Jlc3BvbnNlYCBzaWduYWxzIHRoYXQgdGhlIGNvbW1hbmQgd2FzIGludGVycnVwdGVkXG4gKiAocGxhbiBcdTAwQTc0KS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMsIHNvIHRoaXNcbiAqIGlzIGEgZGVmZW5zaXZlIHJ1bnRpbWUgc2hhcGUtcHJvYmU6IGFuIG9iamVjdCBjYXJyeWluZyBhIHRydXRoeVxuICogYGludGVycnVwdGVkYCBmaWVsZCBcdTIwMTQgb3IgdGhlIGB0aW1lZE91dEFmdGVyTXNgIG1hcmtlciwgdGhlIHNhbWUgY29uZGl0aW9uXG4gKiBpbiB0aGUgb3RoZXIgc3BlbGxpbmcgdGhlIHJlc3BvbnNlLXBhc3Mgbm9ybWFsaXplcnMgbWFwIHRvIGBpbnRlcnJ1cHRlZGAgXHUyMDE0XG4gKiBjbGFzc2lmaWVzIGFzIGludGVycnVwdGVkOyBhbnkgb3RoZXIgc2hhcGUgKHN0cmluZywgbnVsbCwgb2JqZWN0IHdpdGhvdXRcbiAqIGVpdGhlciBmaWVsZCkgcHJvY2VlZHMgZmFpbC1vcGVuLCBtYXRjaGluZyB0b2RheSdzIGJlaGF2aW9yLiBUaGUgZ2F0ZVxuICogcmVhZHMgdGhlIHJhdyBlbnZlbG9wZSwgc28gaXQgbXVzdCByZWNvZ25pemUgYm90aCBzcGVsbGluZ3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBib29sZWFuIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IHJlY29yZCA9IHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICByZXR1cm4gcmVjb3JkLmludGVycnVwdGVkID09PSB0cnVlIHx8IHJlY29yZC50aW1lZE91dEFmdGVyTXMgIT09IHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogVGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgJ3MgcHJvY2VzcyBleGl0IGNvZGUsIHdoZW4gdGhlIGhhcm5lc3Mgc3VwcGxpZXNcbiAqIG9uZS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMgYW5kIENsYXVkZSdzXG4gKiBCYXNoIGVudmVsb3BlcyBkbyBub3QgY3VycmVudGx5IGNhcnJ5IGFuIGBleGl0X2NvZGVgIGZpZWxkLCBzbyB0aGlzIGlzIGFcbiAqIGRlZmVuc2l2ZSBzaGFwZS1wcm9iZSB3aXRoIHRoZSBwbGFuIFx1MDBBNzQgZmFpbC1vcGVuIHBvc3R1cmU6IHByZXNlbnQgXHUyMTkyIHRoZVxuICogaW50ZWdlciBjb2RlLCBhYnNlbnQgb3IgYW55IG90aGVyIHNoYXBlIFx1MjE5MiB1bmRlZmluZWQsIGFuZCB0aGUgY2FsbGVyXG4gKiBwcm9jZWVkcyBleGFjdGx5IGFzIHRvZGF5LiAoVGhlIGhvb2sgc3VicHJvY2VzcydzIG93biBleGl0IHN0YXR1cyBcdTIwMTQgdGhlXG4gKiBTREsncyBgU0RLSG9va1Jlc3BvbnNlTWVzc2FnZS5leGl0X2NvZGVgIFx1MjAxNCBpcyBhIGRpZmZlcmVudCBjaGFubmVsIGFuZCBpc1xuICogbmV2ZXIgcmVhZCBoZXJlLilcbiAqXG4gKiBHcmFudWxhcml0eSBlZGdlIChkb2N1bWVudGVkIHJlc2lkdWUpOiB0aGUgY29kZSBpcyB0aGUgd2hvbGUgY29tcG91bmRcbiAqIGNvbW1hbmQncywgbm90IG9uZSBzaW1wbGUgY29tbWFuZCdzIFx1MjAxNCBhIG1hc2tlZCBmYWlsdXJlIChgZ2l0IGFwcGx5XG4gKiBwLmRpZmYgfHwgZWNobyBva2AgZXhpdGluZyAwKSBzdXBwcmVzc2VzIG5vdGhpbmcsIGFuZCBhIHRyYWlsaW5nIGZhaWx1cmVcbiAqIChgc2VkIC1pIHMvYS9iLyBmOyBmYWxzZWAgZXhpdGluZyAxKSBzdXBwcmVzc2VzIHRoZSBlYXJsaWVyIHJlYWwgd3JpdGUuXG4gKiBBbmQgdGhlIFwiZmFpbGVkLCBzbyB0aGUgd3JpdGUgZGlkIG5vdCBoYXBwZW5cIiBwcmVtaXNlIGJlaGluZCB0aGVcbiAqIHN1cHByZXNzaW9uIGhvbGRzIGZvciBhdG9taWMgZmFpbHVyZXMgKGBnaXQgYXBwbHlgIHdpdGhvdXQgYC0tcmVqZWN0YCxcbiAqIHByZXR0aWVyIG9uIGEgc3ludGF4IGVycm9yKSBidXQgb3Zlci1zdXBwcmVzc2VzIHRoZSBub24tYXRvbWljIHdyaXRlcnNcbiAqIHRoYXQgbW9kaWZ5IGJlZm9yZSBmYWlsaW5nIFx1MjAxNCBHTlUgYHBhdGNoYCBhcHBseWluZyBlYXJsaWVyIGh1bmtzLCBgZ2l0XG4gKiBhcHBseSAtLXJlamVjdGAgd3JpdGluZyB0aGUgYXBwbGljYWJsZSBodW5rcyBwbHVzIGAucmVqYCBmaWxlcywgYW5kXG4gKiBmb3JtYXR0ZXJzIChgZXNsaW50IC0tZml4YCwgYHJ1Ym9jb3AgLWFgKSB3cml0aW5nIHRoZWlyIGZpeGVzIGJlZm9yZVxuICogZXhpdGluZyBub256ZXJvIG9uIHJlbWFpbmluZyB2aW9sYXRpb25zLiBUaGF0IHdyb3RlLWJ1dC1ub256ZXJvIGNvcm5lciBpc1xuICogYWNjZXB0ZWQgYW5kIHBpbm5lZCBieSB0aGUgZ2F0ZSdzIHRlc3RzIHJhdGhlciB0aGFuIGNhcnZlZCBvdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VFeGl0Q29kZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgY29kZSA9ICh0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmV4aXRfY29kZTtcbiAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0ludGVnZXIoY29kZSkpIHJldHVybiBjb2RlO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBlci1jb21tYW5kIHZlcmRpY3QgZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgUmVzb2x2ZWRNYXRjaCA9IEV4dHJhY3Q8U3Bhbk1hdGNoLCB7IHN0YXR1czogJ3Jlc29sdmVkJyB9PjtcbnR5cGUgR3VhcmRNYXRjaCA9IEV4dHJhY3Q8U3Bhbk1hdGNoLCB7IHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnIH0+O1xuXG50eXBlIFZlcmRpY3QgPSAnZmFpbGVkJyB8ICdzdWNjZWVkZWQnIHwgJ3Vua25vd24nO1xuXG4vKipcbiAqIEZpbGUtcHJvZHVjaW5nIHdyaXRlIG9wZXJhdGlvbnMgXHUyMDE0IHRoZSBvbmx5IHNwYW5zIHRoYXQgY2FuIGV4cGxhaW4gYVxuICogZGVsZXRlJ3MgZGVjaXNpdmVGYWlsIGJ5IHJlLWNyZWF0aW5nIGl0cyBwYXRoIGxhdGVyIGluIHRoZSBjb21wb3VuZCAocGxhblxuICogXHUwMEE3MyBzdGVwIDIsIHJvdW5kLTMpLiBgbW9kaWZ5YCAoc2VkIC1pIGFuZCBmcmllbmRzKSBkZWxpYmVyYXRlbHkgY2Fubm90OlxuICogaXQgbmV2ZXIgY3JlYXRlcyBhIG1pc3NpbmcgZmlsZSwgc28gYW4gZW5kLXN0YXRlLXByZXNlbnQgcGF0aCBhZnRlciBhXG4gKiBmYWlsZWQgYHJtYCBpcyBuZXZlciBpdHMgZG9pbmcuXG4gKi9cbmNvbnN0IEZJTEVfUFJPRFVDSU5HX09QUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoWydjcmVhdGUtb3ZlcndyaXRlJywgJ3JlbmFtZS1jb3B5JywgJ3RydW5jYXRlJywgJ2FwcGVuZCddKTtcblxuLyoqIE9uZSBwYXNzLUEgZXZhbHVhdGlvbjogdGhlIHNwYW4sIGl0cyB0b3VjaCwgYW5kIHRoZSAocG9zdC1yZXNvbHV0aW9uKSBnYXRlIG91dGNvbWUuICovXG5pbnRlcmZhY2UgU3BhbkV2YWwge1xuICBtYXRjaDogUmVzb2x2ZWRNYXRjaDtcbiAgLyoqIFRoZSB0cmFuc2xhdGVkIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGUgc3BhbiBmYWlsZWQgYHJlc29sdmVUb3VjaFNjb3BlYC4gKi9cbiAgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsO1xuICAvKiogVGhlIHBhc3MtQSBnYXRlIG91dGNvbWUsIHBvc3QtcmVzb2x1dGlvbiBmb3IgYCdwZW5kaW5nJ2AgYW5kIGV4cGxhaW5lZCBmYWlscy4gKi9cbiAgb3V0Y29tZTogV3JpdGVHYXRlT3V0Y29tZTtcbiAgLyoqIEEgZGVjaXNpdmVGYWlsIGRvd25ncmFkZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgZXhwbGFpbmVkOiBib29sZWFuO1xuICBjb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqIFRoZSBzcGFuJ3Mgb3duIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIGRlY2lzaXZlIGZhaWxzLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBjcCBkZXN0aW5hdGlvbnM6IHRoZSBwYWlyZWQgc291cmNlIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIHBlbmRpbmdzLiAqL1xuICBzb3VyY2VLZXk6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogRXZhbHVhdGUgb25lIHNwYW4ncyBnYXRlLiBSZWFkcyBoYXZlIG5vIGdhdGUgXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AsIHdpdGggb25lXG4gKiBleGNlcHRpb246IGNwL2luc3RhbGwgc291cmNlIHJlYWRzIGdhdGUgb24gdGhlIHNvdXJjZSBleGlzdGluZyBwb3N0LWNvbW1hbmRcbiAqIChwbGFuIFx1MDBBNzIpIFx1MjAxNCBhIGZhaWxlZCBjb3B5IG5ldmVyIHJlYWQgYW55dGhpbmcuIFRoZSByZWFkIHZlcmRpY3QgZmxpcHMgb25seVxuICogdGhlIGNvbW1hbmQncyBqb2luIHZlcmRpY3QsIG5ldmVyIHRoZSBzYW1lIGNvbW1hbmQncyBkZXN0IHdyaXRlLlxuICovXG5mdW5jdGlvbiBldmFsU3BhbkdhdGUobWF0Y2g6IFJlc29sdmVkTWF0Y2gsIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKHRvdWNoID09PSBudWxsKSByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIGlmICh0b3VjaC5raW5kID09PSAncmVhZCcpIHtcbiAgICBpZiAoKG1hdGNoLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG1hdGNoLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG1hdGNoLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHJldHVybiBmaWxlRXhpc3RzKG1hdGNoLnNwYW4uYWJzb2x1dGVQYXRoKSA/ICdpbmNvbmNsdXNpdmUnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgfVxuICByZXR1cm4gZXZhbHVhdGVXcml0ZUdhdGUodG91Y2gsIHByb2JlQ2FjaGUpO1xufVxuXG4vKiogVGhlIG9wZXJhdG9yIHByZWNlZGluZyBhIGNvbW1hbmQsIGZyb20gaXRzIGZpcnN0IHNwYW4gKGFsbCBzcGFucyBvZiBvbmUgY29tbWFuZCBzaGFyZSBpdCkgXHUyMDE0IG9yIGZyb20gaXRzIGd1YXJkIG1hdGNoIHdoZW4gdGhlIGNvbW1hbmQgaGFzIG5vIHNwYW5zLiAqL1xuZnVuY3Rpb24gam9pbk9mQ29tbWFuZChcbiAgaWR4OiBudW1iZXIsXG4gIGdyb3VwczogTWFwPG51bWJlciwgUmVzb2x2ZWRNYXRjaFtdPixcbiAgZ3VhcmRCeUluZGV4OiBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPlxuKTogJyYmJyB8ICd8fCcgfCB1bmRlZmluZWQge1xuICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgaWYgKHNwYW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGlmIChtLnNwYW4uam9pbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gbS5zcGFuLmpvaW47XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGd1YXJkQnlJbmRleC5nZXQoaWR4KT8uam9pbjtcbn1cblxuLyoqXG4gKiBTaGFyZWQgQmFzaCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBvd25zIHRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IHRocmVhZCBcdTIwMTRcbiAqIHBhc3MgQSBgZXZhbHVhdGVXcml0ZUdhdGVgIHN3ZWVwIChldmVyeSBzcGFuLCBiZWZvcmUgYW55IGpvaW4gZGVjaXNpb24pLFxuICogdGhlIGV4cGxhbmF0aW9uIG1hcCwgcGVyLWNvbW1hbmQgdmVyZGljdHMsIHRoZSBqb2luIGZpbHRlciB3aXRoIGNoYWluZWRcbiAqIHNraXBzLCBhbmQgcGFzcyBCIHBlci1zdXJ2aXZpbmctc3BhbiBgcnVuVG91Y2hIb29rYCBcdTIwMTQgcGx1cyB0aGUgd2hvbGUtY29tbWFuZFxuICogYGludGVycnVwdGVkYCBhbmQgZXhpdC1jb2RlIGdhdGVzIChwbGFuIFx1MDBBNzQpIGFuZCB0aGUgc3Bhbi1sZXNzLWd1YXJkXG4gKiBjb21tYW5kcyAoYGZhbHNlYC9gdHJ1ZWAvYDpgIGpvaW4gdmVyZGljdHMgd2l0aCBubyBzcGFucyBvZiB0aGVpciBvd24pLlxuICogUmV0dXJucyB0aGUgbm9uLW51bGwgYGFkZGl0aW9uYWxDb250ZXh0YCBibG9ja3MgZm9yIHRoZSBhZGFwdGVyIHRvIGpvaW47XG4gKiB0aGUgc2Vzc2lvbiBtZW1vIGRlZHVwcyByZXBlYXRlZCB0YXJnZXRzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmFzaFRvdWNoZXMoXG4gIG1hdGNoZXM6IFNwYW5NYXRjaFtdLFxuICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgY3dkOiBzdHJpbmcsXG4gIHRvb2xSZXNwb25zZTogdW5rbm93bixcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICB3YXJuOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gY29uc29sZS53YXJuXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIC8vIEEgY29tbWFuZCB0aGF0IGRpZCBub3QgY29tcGxldGUgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zLlxuICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlKSkgcmV0dXJuIFtdO1xuICBjb25zdCBleGl0Q29kZSA9IGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZSk7XG4gIGNvbnN0IHJlc29sdmVkID0gbWF0Y2hlcy5maWx0ZXIoKG0pOiBtIGlzIFJlc29sdmVkTWF0Y2ggPT4gbS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpO1xuICBjb25zdCBndWFyZHMgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgR3VhcmRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ2J1aWx0aW4tZ3VhcmQnKTtcbiAgaWYgKHJlc29sdmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIC8vIFNlZWQgdGhlIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYykgd2l0aCBldmVyeSBhYnNlbnRcbiAgLy8gdGFyZ2V0IGFuZCBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQ7IHRoZSBmaXJzdCBnYXRlIHRoYXQgbmVlZHNcbiAgLy8gaXQgcnVucyBvbmUgbHMtZmlsZXMgKyBvbmUgc3Bhbi1saXN0IGJhdGNoIGZvciBhbGwgb2YgdGhlbS4gVGhlXG4gIC8vIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uJ3MgcHJvYmUgc2NvcGUgKHJvdW5kLTMpIHJpZGVzIGFsb25nc2lkZTogdGhlXG4gIC8vIGRlbGV0ZSBwYXRocyBhIGxhdGVyIGNvbW1hbmQgY2FuIHJlLWNyZWF0ZSB3aXRoIGEgZmlsZS1wcm9kdWNpbmcgd3JpdGUgXHUyMDE0XG4gIC8vIHRoZWlyIHdvcmtpbmctdHJlZS12cy1pbmRleCBzdGF0dXMgaXMgdGhlIHJlLWNyZWF0ZSdzIG1hcmssIHJlYWQgb25jZSBpblxuICAvLyBvbmUgYGdpdCBzdGF0dXNgIGJhdGNoLlxuICBjb25zdCBwcm9iZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBmaWxlUHJvZHVjaW5nQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcltdPigpO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBlbHNlIGlmICgobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJykge1xuICAgICAgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIH0gZWxzZSBpZiAoRklMRV9QUk9EVUNJTkdfT1BTLmhhcyhtLnNwYW4ub3BlcmF0aW9uKSkge1xuICAgICAgY29uc3QgbGlzdCA9IGZpbGVQcm9kdWNpbmdCeVBhdGguZ2V0KG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgICAgaWYgKGxpc3QgIT09IHVuZGVmaW5lZCkgbGlzdC5wdXNoKG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICAgICAgZWxzZSBmaWxlUHJvZHVjaW5nQnlQYXRoLnNldChtLnNwYW4uYWJzb2x1dGVQYXRoLCBbbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleF0pO1xuICAgIH1cbiAgfVxuICBjb25zdCByZWNyZWF0ZVByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uICE9PSAnZGVsZXRlJykgY29udGludWU7XG4gICAgY29uc3QgbGF0ZXIgPSAoZmlsZVByb2R1Y2luZ0J5UGF0aC5nZXQobS5zcGFuLmFic29sdXRlUGF0aCkgPz8gW10pLnNvbWUoKGkpID0+IGkgPiBtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4KTtcbiAgICBpZiAobGF0ZXIpIHJlY3JlYXRlUHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGNvbnN0IHByb2JlQ2FjaGUgPSBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwcm9iZVBhdGhzLCByZWNyZWF0ZVByb2JlUGF0aHMpO1xuXG4gIC8vIEdyb3VwIGJ5IHNpbXBsZSBjb21tYW5kIGluIHdhbGtlciBvcmRlci4gU3Bhbi1sZXNzIGd1YXJkIGNvbW1hbmRzXG4gIC8vIChgZmFsc2VgL2B0cnVlYC9gOmApIGpvaW4gdGhlIG9yZGVyIHdpdGggbm8gZ3JvdXA6IHRoZWlyIGRldGVybWluaXN0aWNcbiAgLy8gZXhpdCBzdGF0dXMgZHJpdmVzIHRoZSBqb2luIGZpbHRlciwgYW5kIHRoZXkgbmV2ZXIgdG91Y2ggYW55dGhpbmcuXG4gIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+KCk7XG4gIGNvbnN0IGd1YXJkQnlJbmRleCA9IG5ldyBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPigpO1xuICBjb25zdCBjb21tYW5kT3JkZXI6IG51bWJlcltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGNvbnN0IGlkeCA9IG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXg7XG4gICAgY29uc3QgbGlzdCA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaXN0LnB1c2gobSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3Vwcy5zZXQoaWR4LCBbbV0pO1xuICAgICAgY29tbWFuZE9yZGVyLnB1c2goaWR4KTtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBnIG9mIGd1YXJkcykge1xuICAgIGlmIChncm91cHMuaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSB8fCBndWFyZEJ5SW5kZXguaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSkgY29udGludWU7XG4gICAgZ3VhcmRCeUluZGV4LnNldChnLnNpbXBsZUNvbW1hbmRJbmRleCwgZyk7XG4gICAgY29tbWFuZE9yZGVyLnB1c2goZy5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICB9XG4gIGNvbW1hbmRPcmRlci5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG5cbiAgLy8gUGFzcyBBOiB0cmFuc2xhdGUgZXZlcnkgc3BhbiBvbmNlIGFuZCBldmFsdWF0ZSBpdHMgZ2F0ZSwgcGFpcmluZ1xuICAvLyBjcC9pbnN0YWxsIHNvdXJjZXMgd2l0aCBkZXN0aW5hdGlvbnMgYW5kIG12IGRlbGV0ZXMgd2l0aCByZW5hbWUtY29waWVzIGJ5XG4gIC8vIGRlY2xhcmF0aW9uIG9yZGVyICh0aGUgcGFyc2VyIGVtaXRzIHNvdXJjZXMgYmVmb3JlIGRlc3RpbmF0aW9ucykuXG4gIGNvbnN0IGV2YWxzID0gbmV3IE1hcDxudW1iZXIsIFNwYW5FdmFsW10+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChzcGFucyA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gZ3VhcmQtb25seSBjb21tYW5kIFx1MjAxNCBub3RoaW5nIHRvIGV2YWx1YXRlXG4gICAgY29uc3QgcmVhZFBhdGhzID0gc3BhbnNcbiAgICAgIC5maWx0ZXIoKG0pID0+IChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKVxuICAgICAgLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgY29uc3QgZGVsZXRlUGF0aHMgPSBzcGFucy5maWx0ZXIoKG0pID0+IG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKS5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGxldCByZWFkQ3Vyc29yID0gMDtcbiAgICBsZXQgZGVsZXRlQ3Vyc29yID0gMDtcbiAgICBjb25zdCBsaXN0OiBTcGFuRXZhbFtdID0gW107XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBjb25zdCB0b3VjaCA9IGJhc2hTcGFuVG9Ub3VjaChtLnNwYW4sIHNlc3Npb25JZCwgY3dkKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTcGFuRXZhbCA9IHtcbiAgICAgICAgbWF0Y2g6IG0sXG4gICAgICAgIHRvdWNoLFxuICAgICAgICBvdXRjb21lOiAnaW5jb25jbHVzaXZlJyxcbiAgICAgICAgZXhwbGFpbmVkOiBmYWxzZSxcbiAgICAgICAgY29tbWFuZEluZGV4OiBpZHgsXG4gICAgICAgIHBhdGg6IG0uc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNvdXJjZUtleTogbnVsbFxuICAgICAgfTtcbiAgICAgIGlmICh0b3VjaCAhPT0gbnVsbCAmJiB0b3VjaC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnY3JlYXRlLW92ZXJ3cml0ZScgJiYgKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSkge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlYWRQYXRoc1tyZWFkQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJlYWRDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIC8vIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZDogc3RyaXBwZWRcbiAgICAgICAgICAgIC8vIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAgICAgICAgICAvLyBleGlzdGVuY2Utb25seSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLlxuICAgICAgICAgICAgaWYgKG0uaWRpb20gPT09ICdjcC13cml0ZScpIHtcbiAgICAgICAgICAgICAgdG91Y2guc291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICAgICAgZW50cnkuc291cmNlS2V5ID0gc291cmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAncmVuYW1lLWNvcHknKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gZGVsZXRlUGF0aHNbZGVsZXRlQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZUN1cnNvciArPSAxO1xuICAgICAgICAgICAgdG91Y2gucmVuYW1lU291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVudHJ5Lm91dGNvbWUgPSBldmFsU3BhbkdhdGUobSwgdG91Y2gsIHByb2JlQ2FjaGUpO1xuICAgICAgbGlzdC5wdXNoKGVudHJ5KTtcbiAgICB9XG4gICAgZXZhbHMuc2V0KGlkeCwgbGlzdCk7XG4gIH1cblxuICAvLyBUaGUgZXhwbGFuYXRpb24gbWFwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogdGhlIGhpZ2hlc3Qgc2ltcGxlQ29tbWFuZEluZGV4IHdpdGhcbiAgLy8gYSBkZWNpc2l2ZVBhc3Mgb24gZWFjaCBwYXRoLlxuICBjb25zdCBwYXNzQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykge1xuICAgICAgICBjb25zdCBwcmV2ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSBwYXNzQnlQYXRoLnNldChlLnBhdGgsIGlkeCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUmVzb2x2ZSB0aGUgYWJzZW50LXNvdXJjZSBob2xkcyBhZ2FpbnN0IHRoZSBub3ctY29tcGxldGUgbWFwLCBhbmRcbiAgLy8gZG93bmdyYWRlIGV4cGxhaW5lZCBmYWlsczogYSBkZWNpc2l2ZUZhaWwgb24gYSBwYXRoIGEgbGF0ZXIgY29tbWFuZFxuICAvLyBkZW1vbnN0cmFibHkgcmV3cm90ZSBvciBkZWxldGVkIGlzIHRoZSBvdmVyd3JpdGUsIG5vdCB0aGUgZWFybGllciBjb21tYW5kXG4gIC8vIGZhaWxpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdwZW5kaW5nJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gZS5zb3VyY2VLZXkgIT09IG51bGwgPyBwYXNzQnlQYXRoLmdldChlLnNvdXJjZUtleSkgOiB1bmRlZmluZWQ7XG4gICAgICAgIGUub3V0Y29tZSA9IHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXggPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfSBlbHNlIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBwYXNzQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCkgZS5leHBsYWluZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbiAocm91bmQtMywgbWFyayB3aWRlbmVkIHJvdW5kLTQpOiBhXG4gIC8vIGRlbGV0ZSdzIGRlY2lzaXZlRmFpbCBcdTIwMTQgXCJmaWxlIHByZXNlbnQsIHNvIHRoZSBkZWxldGUgZGlkbid0IGhhcHBlblwiIFx1MjAxNCBpc1xuICAvLyBhbHNvIGV4cGxhaW5lZCB3aGVuIGEgTEFURVIgY29tbWFuZCB3cml0ZXMgdGhlIHNhbWUgcGF0aCB3aXRoIGFcbiAgLy8gZmlsZS1wcm9kdWNpbmcgb3BlcmF0aW9uIHdob3NlIG93biBnYXRlIGRpZCBub3QgZmFpbCAoYSBkZWNpc2l2ZUZhaWxcbiAgLy8gdGhlcmUgcHJvdmVzIHRoZSB3cml0ZSBkaWRuJ3QgaGFwcGVuKSBBTkQgdGhlIHBhdGggY2FycmllcyBhbnkgdHJhY2tlZFxuICAvLyBzdGF0dXMgcm93IFx1MjAxNCBpbmRleCBjb2x1bW4gb3Igd29ya3RyZWUgY29sdW1uLCByZWFkIGZyb20gdGhlIHBlci1jb21tYW5kXG4gIC8vIHByb2JlIChzZWUgdGhlIHByb2JlJ3MgcGVyLWNvbHVtbiByZWFzb25pbmcpLiBBIGZpbGUgd2l0aCBOTyBzdGF0dXMgcm93XG4gIC8vIG1lYW5zIGl0IHN0aWxsIG1hdGNoZXMgSEVBRDogdGhlIGNoYWluIHNob3J0LWNpcmN1aXRlZCBiZWZvcmUgdGhlIHdyaXRlXG4gIC8vICh0aGUgcm0gZmFpbGVkIGFuZCBgJiZgIGRyb3BwZWQgdGhlIHJlc3QpLCBzbyB0aGUgZmFpbCBzdGFuZHMgYW5kIHRoZVxuICAvLyBqb2luIGZpbHRlciBzdGlsbCBzdXBwcmVzc2VzIHRoZSBqb2luZWQgY29tbWFuZC4gVGhlIGluZGV4IGNvbHVtbiBpc1xuICAvLyB3aGF0IHNlcGFyYXRlcyB0aGUgdHdvIHJlYWxpdGllcyBhIGNsZWFuIHdvcmt0cmVlIGNhbm5vdDogYHJtIGYgJiYgcGF0Y2hcbiAgLy8gLXAwIDwgZCAmJiBnaXQgYWRkIGZgIGVuZHMgd2l0aCBmIHN0YWdlZCAoYE0gYCByb3csIGJsYW5rIHdvcmt0cmVlXG4gIC8vIGNvbHVtbikgXHUyMDE0IHRoZSB3cml0ZSByYW4gYW5kIHdhcyB2ZXJpZmllZCBpbnRvIHRoZSBpbmRleCBcdTIwMTQgd2hpbGUgYVxuICAvLyBnZW51aW5lbHkgZmFpbGVkIHJtIGxlYXZlcyBubyByb3cgYXQgYWxsLiBUaGlzIGlzIHRoZSBleGlzdGVuY2UtZ2F0ZWRcbiAgLy8gc2libGluZyBvZiB0aGUgZGVjaXNpdmVQYXNzIGV4cGxhbmF0aW9uIGFib3ZlOiBgcm0gZiAmJiBwYXRjaCAtcDAgPFxuICAvLyBuZXcuZGlmZmAgZW5kcyB3aXRoIGYgcHJlc2VudCBiZWNhdXNlIHRoZSBwYXRjaCByZS1jcmVhdGVkIGl0LCBub3RcbiAgLy8gYmVjYXVzZSB0aGUgcm0gZmFpbGVkLCBhbmQgdGhlIHBhdGNoJ3MgZ2F0ZSBpcyBpbmNvbmNsdXNpdmUgXHUyMDE0IG9ubHkgdGhpc1xuICAvLyBydWxlIGNhbiBzZWUgdGhlIHJlLWNyZWF0ZS4gQ29udGVudC12ZXJpZmllZCByZS1jcmVhdGVzIChlY2hvL2NwL1xuICAvLyB0cnVuY2F0ZSB3aXRoIGEgYm9keSkgbmV2ZXIgbmVlZCBpdCBcdTIwMTQgdGhlaXIgZGVjaXNpdmVQYXNzIGV4cGxhaW5zIHZpYVxuICAvLyB0aGUgbWFwIGFib3ZlLiBSZXNpZHVhbDogYSBwcmUtZXhpc3RpbmcgdW5jb21taXR0ZWQgT1Igc3RhZ2VkIGNoYW5nZSBvblxuICAvLyB0aGUgZGVsZXRlZCBwYXRoIG1hc2tzIHRoZSBkaXNjcmltaW5hdG9yICh0aGUgZmlsZSBkaWZmZXJlZCBmcm9tIHRoZVxuICAvLyBpbmRleCBiZWZvcmUgdGhlIGNvbXBvdW5kIGV2ZXIgcmFuKSwgc28gYW4gcm0gdGhhdCBmYWlsZWQgb24gYSBkaXJ0eVxuICAvLyBwYXRoIGxldHMgdGhlIGpvaW5lZCB3cml0ZSBmaXJlIGFkdmlzb3J5IFx1MjAxNCBzYW1lIGJvdW5kZWQgaGFybSBhcyB0aGVcbiAgLy8gcGxhbidzIGRvY3VtZW50ZWQgXCJjb2luY2lkZW50YWxseSBwYXNzZXNcIiBqb2luIGNvcm5lciwgYW5kIGFcbiAgLy8gaGFybmVzcy1zdXBwbGllZCBub24temVybyBleGl0IGNvZGUgc3RpbGwgc3VwcHJlc3NlcyB0aGUgYWR2aXNvcnkgY2xhc3NcbiAgLy8gaW4gcGFzcyBCLiBUaGUgc3RhZ2VkIGZhY2UgaXMgdGhlIHdpZGVuaW5nJ3Mgb25lIGNvc3Q6IHJvdW5kLTMncyBibGFuay1ZXG4gIC8vIHJ1bGUga2VwdCBgTSBgL2BBIGAgcm93cyBpbnZpc2libGUsIHNvIGEgZmFpbGVkIHJtIG9uIGEgcHJlLXN0YWdlZCBwYXRoXG4gIC8vIHN0YXllZCBmdWxseSBzdXBwcmVzc2VkOyB0aGUgaW5kZXggY29sdW1uIG5vdyBtYXJrcyBpdCwgYW5kIHRoZSBqb2luZWRcbiAgLy8gd3JpdGUgZmlyZXMgYWR2aXNvcnkgd2hlcmV2ZXIgZ2VudWluZSBzdGFnZWQgZHJpZnQgZXhpc3RzIGFnYWluc3QgdGhlXG4gIC8vIHNwYW4gYmFzZWxpbmUgKHBpbm5lZCBlbmQtdG8tZW5kIGluIHRoZSBpbnRlZ3JhdGlvbiBzdWl0ZSkuXG4gIGNvbnN0IHJlY3JlYXRlQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykgY29udGludWU7XG4gICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLnRvdWNoLmtpbmQgIT09ICd3cml0ZScgfHwgZS50b3VjaC50YXJnZXRTdGF0ZSAhPT0gJ2V4aXN0cycpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFGSUxFX1BST0RVQ0lOR19PUFMuaGFzKGUubWF0Y2guc3Bhbi5vcGVyYXRpb24pKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHByZXYgPSByZWNyZWF0ZUJ5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQgfHwgaWR4ID4gcHJldikgcmVjcmVhdGVCeVBhdGguc2V0KGUucGF0aCwgaWR4KTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlY3JlYXRlQnlQYXRoLnNpemUgPiAwKSB7XG4gICAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICAgIGlmIChlLm91dGNvbWUgIT09ICdkZWNpc2l2ZUZhaWwnIHx8IGUuZXhwbGFpbmVkKSBjb250aW51ZTtcbiAgICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS50b3VjaC5raW5kICE9PSAnd3JpdGUnIHx8IGUudG91Y2gudGFyZ2V0U3RhdGUgIT09ICdhYnNlbnQnKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVjcmVhdGVJZHggPSByZWNyZWF0ZUJ5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHJlY3JlYXRlSWR4ICE9PSB1bmRlZmluZWQgJiYgcmVjcmVhdGVJZHggPiBlLmNvbW1hbmRJbmRleCAmJiB3b3JraW5nVHJlZUNoYW5nZWQocHJvYmVDYWNoZSwgY3dkLCBlLnBhdGgpKSB7XG4gICAgICAgICAgZS5leHBsYWluZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUGVyLWNvbW1hbmQgdmVyZGljdHM6ICdmYWlsZWQnIG9uIGFueSB1bmV4cGxhaW5lZCBkZWNpc2l2ZUZhaWwsIGVsc2VcbiAgLy8gJ3N1Y2NlZWRlZCcgb24gYXQgbGVhc3Qgb25lIGRlY2lzaXZlIG91dGNvbWUsIGVsc2UgJ3Vua25vd24nLiBBXG4gIC8vIGd1YXJkLW9ubHkgY29tbWFuZCdzIGRldGVybWluaXN0aWMgZXhpdCBzdGF0dXMgSVMgaXRzIHZlcmRpY3QgKHBsYW4gXHUwMEE3M1xuICAvLyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmQgcnVsZSkuXG4gIGNvbnN0IGNvbXB1dGVkID0gbmV3IE1hcDxudW1iZXIsIFZlcmRpY3Q+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBndWFyZCA9IGd1YXJkQnlJbmRleC5nZXQoaWR4KTtcbiAgICAgIGNvbXB1dGVkLnNldChpZHgsIGd1YXJkICE9PSB1bmRlZmluZWQgPyAoZ3VhcmQuZXhpdFN0YXR1cyA9PT0gMCA/ICdzdWNjZWVkZWQnIDogJ2ZhaWxlZCcpIDogJ3Vua25vd24nKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgZmFpbGVkID0gZmFsc2U7XG4gICAgbGV0IHBhc3NlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyAmJiAhZS5leHBsYWluZWQpIGZhaWxlZCA9IHRydWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykgcGFzc2VkID0gdHJ1ZTtcbiAgICB9XG4gICAgY29tcHV0ZWQuc2V0KGlkeCwgZmFpbGVkID8gJ2ZhaWxlZCcgOiBwYXNzZWQgPyAnc3VjY2VlZGVkJyA6ICd1bmtub3duJyk7XG4gIH1cblxuICAvLyBUaGUgam9pbiBmaWx0ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhIHNraXBwZWQgY29tbWFuZCdzIGNoYWluZWQgdmVyZGljdCBpc1xuICAvLyB0aGUgZ3VhcmQgdGhhdCBza2lwcGVkIGl0IFx1MjAxNCAnZmFpbGVkJyBhZnRlciBhbiAmJi1za2lwLCAnc3VjY2VlZGVkJyBhZnRlclxuICAvLyBhbiB8fC1za2lwIFx1MjAxNCBtYXRjaGluZyB0aGUgc2hlbGwgc2hvcnQtY2lyY3VpdCAoYSB8fCBiIHx8IGMgc3RvcHMgYWZ0ZXJcbiAgLy8gdGhlIGZpcnN0IHN1Y2Nlc3MpLiAndW5rbm93bicgZmFpbHMgb3Blbi5cbiAgY29uc3QgZWZmZWN0aXZlID0gbmV3IE1hcDxudW1iZXIsIFZlcmRpY3Q+KCk7XG4gIGNvbnN0IHNraXBwZWQgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgbGV0IHByZXZJbmRleDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGpvaW4gPSBqb2luT2ZDb21tYW5kKGlkeCwgZ3JvdXBzLCBndWFyZEJ5SW5kZXgpO1xuICAgIGNvbnN0IHByZXZWZXJkaWN0ID0gcHJldkluZGV4ICE9PSBudWxsID8gZWZmZWN0aXZlLmdldChwcmV2SW5kZXgpIDogdW5kZWZpbmVkO1xuICAgIGlmIChwcmV2VmVyZGljdCAhPT0gdW5kZWZpbmVkICYmIGpvaW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKChqb2luID09PSAnJiYnICYmIHByZXZWZXJkaWN0ID09PSAnZmFpbGVkJykgfHwgKGpvaW4gPT09ICd8fCcgJiYgcHJldlZlcmRpY3QgPT09ICdzdWNjZWVkZWQnKSkge1xuICAgICAgICBlZmZlY3RpdmUuc2V0KGlkeCwgam9pbiA9PT0gJyYmJyA/ICdmYWlsZWQnIDogJ3N1Y2NlZWRlZCcpO1xuICAgICAgICBza2lwcGVkLmFkZChpZHgpO1xuICAgICAgICBwcmV2SW5kZXggPSBpZHg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBlZmZlY3RpdmUuc2V0KGlkeCwgY29tcHV0ZWQuZ2V0KGlkeCkhKTtcbiAgICBwcmV2SW5kZXggPSBpZHg7XG4gIH1cblxuICAvLyBQYXNzIEI6IHJ1biB0aGUgdG91Y2ggaG9vayBmb3Igc3Vydml2aW5nIHNwYW5zIG9ubHkgXHUyMDE0IGRlY2lzaXZlUGFzcywgb3JcbiAgLy8gaW5jb25jbHVzaXZlIHdpdGggYW4gJ2V4aXN0cycgdGFyZ2V0ICh0aGUgYWR2aXNvcnkgcmVzaWR1YWwgY2xhc3M6XG4gIC8vIGV4aXN0ZW5jZS1nYXRlZCBmYW1pbGllcyBmaXJlIGFuZCBoZWFsL3N1cmZhY2U7IHBoYW50b20gZGVsZXRlcyBuZXZlclxuICAvLyBmaXJlKS4gQSBoYXJuZXNzLXN1cHBsaWVkIG5vbi16ZXJvIGV4aXQgY29kZSBzdXBwcmVzc2VzIHRoZSBhZHZpc29yeVxuICAvLyBjbGFzcyB0b28sIGJvdW5kZWQgYnkgdHdvIGRvY3VtZW50ZWQtcmVzaWR1ZSBmYWNlcyAoc2VlXG4gIC8vIGJhc2hSZXNwb25zZUV4aXRDb2RlKTogdGhlIGNvZGUgaXMgdGhlIGNvbXBvdW5kJ3MsIHNvIGEgbWFza2VkIGZhaWx1cmVcbiAgLy8gKGBnaXQgYXBwbHkgcC5kaWZmIHx8IGVjaG8gb2tgIGV4aXRpbmcgMCkgc3VwcHJlc3NlcyBub3RoaW5nIGFuZCBhXG4gIC8vIHRyYWlsaW5nIGZhaWx1cmUgKGBzZWQgLWkgcy9hL2IvIGY7IGZhbHNlYCkgc3VwcHJlc3NlcyBhbiBlYXJsaWVyIHJlYWxcbiAgLy8gd3JpdGUgXHUyMDE0IGFuZCBhIG5vbnplcm8gY29kZSBkb2VzIG5vdCBwcm92ZSB0aGUgd3JpdGUgZGlkIG5vdCBoYXBwZW4gZm9yXG4gIC8vIHRoZSBub24tYXRvbWljIHdyaXRlcnMgdGhhdCBtb2RpZnkgYmVmb3JlIGZhaWxpbmcgKHBhdGNoIGFwcGx5aW5nXG4gIC8vIGVhcmxpZXIgaHVua3MsIGBnaXQgYXBwbHkgLS1yZWplY3RgLCBmb3JtYXR0ZXJzIHdyaXRpbmcgZml4ZXMgdGhlblxuICAvLyBleGl0aW5nIG5vbnplcm8pLiBBIHplcm8gb3IgYWJzZW50IGNvZGUgcHJvY2VlZHMsIGFuZCBjb250ZW50LXZlcmlmaWVkXG4gIC8vIGRlY2lzaXZlIHBhc3NlcyBmaXJlIHJlZ2FyZGxlc3MgKGZhaWwtb3BlbiwgcGxhbiBcdTAwQTc0KS4gR3VhcmQtb25seVxuICAvLyBjb21tYW5kcyBoYXZlIG5vIHRvdWNoZXMuIEV4cGxhaW5lZCBmYWlscyBhbmQgZGVjaXNpdmUgZmFpbHMgbmV2ZXJcbiAgLy8gcmVhY2ggYW4gZXhlY3V0b3IuXG4gIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgaWYgKHNraXBwZWQuaGFzKGlkeCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBsZXQgdG91Y2hlcyA9IDA7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUuZXhwbGFpbmVkKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGUudG91Y2gua2luZCA9PT0gJ3dyaXRlJyAmJiBlLnRvdWNoLnRhcmdldFN0YXRlID09PSAnYWJzZW50JykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZXhpdENvZGUgIT09IHVuZGVmaW5lZCAmJiBleGl0Q29kZSAhPT0gMClcbiAgICAgICAgY29udGludWU7XG4gICAgICBpZiAodG91Y2hlcyA+PSAzMikge1xuICAgICAgICAvLyBIYXJkIHBlci1jb21tYW5kIHZvbHVtZSBjYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBkcm9wIHRoZSBzdXJwbHVzIHdpdGhcbiAgICAgICAgLy8gYSB3YXJuaW5nIHJhdGhlciB0aGFuIGJsb3cgdGhlIGhvb2sgdGltZW91dCBvbiBhIDUwLWNvcHkgY2hhaW4uXG4gICAgICAgIHdhcm4oYEJhc2ggdG91Y2ggY2FwICgzMikgcmVhY2hlZCBmb3Igc2ltcGxlIGNvbW1hbmQgJHtpZHh9OyBkcm9wcGluZyB0aGUgcmVtYWluaW5nIHRvdWNoZXNgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0b3VjaGVzICs9IDE7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soZS50b3VjaCwgZXhlY3V0b3JzLCBtZW1vLCBwcm9iZUNhY2hlKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBibG9ja3M7XG59XG4iLCAiLyoqXG4gKiBTdGF0aWMgY2xhc3NpZmljYXRpb24gb2YgYSBCYXNoIHRvb2wgYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlXG4gKiBwYXRoKHMpICsgbGluZSByYW5nZShzKSBpdCByZWFkcyBvciB3cml0ZXMsIHdoZXJlIHRoYXQncyBzdGF0aWNhbGx5XG4gKiBkZXRlcm1pbmFibGUuIEJ1aWx0IGZyb20gYW4gZW1waXJpY2FsIHBhc3Mgb3ZlciB+MzFrIHJlYWwgQ2xhdWRlIENvZGVcbiAqIEJhc2ggaW52b2NhdGlvbnMgKHNlZSBhbmFseXplLXRyYW5zY3JpcHRzLm10cykgXHUyMDE0IHRoZSBpZGlvbXMgYmVsb3cgYXJlXG4gKiBleGFjdGx5IHRoZSBvbmVzIHRoYXQgdHVybmVkIG91dCB0byBiZSBjb21tb24gQU5EIHJlbGlhYmxlIHRoZXJlLlxuICpcbiAqIERlbGliZXJhdGVseSBOT1QgY292ZXJlZCAoc2VlIHRoZSByZXNlYXJjaCByZXBvcnQpOiBhd2sgTlItdHJpY2tzIChyYXJlLFxuICogdW5jb25zdHJhaW5lZCBzeW50YXgpLCBncmVwIC1uLy1BLy1CLy1DICh0aGUgd2luZG93IGlzIGFuY2hvcmVkIHRvIG1hdGNoXG4gKiBwb3NpdGlvbiwgd2hpY2ggaXMgZGF0YS1kZXBlbmRlbnQsIG5vdCBpbiB0aGUgY29tbWFuZCB0ZXh0KSwgZW1iZWRkZWRcbiAqIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50IGxhbmd1YWdlJ3MgQVNULCBub3QgYSBzaGVsbFxuICogY29uY2VybiksIGFuZCBgZmluZCA8ZGlyPiAtbmFtZS8tcGF0aCAuLi4gLWRlbGV0ZWAgKHRoZSBkZWxldGVkIHBhdGhzIGFyZVxuICogdGhlIGRpcmVjdG9yeSdzIGNvbnRlbnRzIGFzIHRoZSBmaW5kZXIgd2Fsa3MgaXQgXHUyMDE0IGRhdGEtZGVwZW5kZW50LCBub3RcbiAqIHN0YXRpY2FsbHkgZW51bWVyYWJsZTsgdGhlIHJlY3Vyc2l2ZS1yZW1vdmFsIGZhaWwtY2xvc2VkIHJ1bGUgYXBwbGllcykuXG4gKlxuICogVGhlIGNhcmQncyB3cml0ZS10b3VjaCBmYW1pbGllcyBcdTIwMTQgcmVkaXJlY3Rpb25zIGFuZCBoZXJlZG9jcyAoXHUwMEE3NS4xXHUyMDEzXHUwMEE3NS4yKSxcbiAqIGNwIGFuZCBpbnN0YWxsIChcdTAwQTc1LjMpLCBtdiBhbmQgZ2l0IG12IChcdTAwQTc1LjQpLCBybSBhbmQgdHJ1bmNhdGUgKFx1MDBBNzUuNSksXG4gKiBzZWQgLWkgKFx1MDBBNzUuNiksIHBhdGNoIGFuZCBnaXQgYXBwbHkgKFx1MDBBNzUuNyksIGZvcm1hdHRlciB3cml0ZSBmbGFncyAoXHUwMEE3NS44KSxcbiAqIGFuZCBnaXQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlY3MgKFx1MDBBNzUuOSkgXHUyMDE0IGFyZSB0aGUgZ3JhbW1hcnMgYmVsb3cuIEVhY2hcbiAqIGZhbWlseSBmYWlscyBjbG9zZWQgb24gd2hhdCBpdCBjYW5ub3Qgc3RhdGljYWxseSBhdHRyaWJ1dGU6XG4gKiBzaGVsbC1leHBhbmRlZCBvciBkeW5hbWljIGNvbnRlbnQsIHJlY3Vyc2l2ZSByZW1vdmFsIChgcm0gLXJgKSxcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApLCBkaXJlY3Rvcnktc2hhcGVkIHRhcmdldHMsIHdyYXBwZXItd3JhcHBlZCBjb21tYW5kc1xuICogd2hvc2UgYXJndiBjYW5ub3QgYmUgcmVjb3ZlcmVkLCBhbmQgdW5tYXRjaGVkIHBhdGhzcGVjcyBlbWl0IG5vIHNwYW4gYXRcbiAqIGFsbCBvciBhbiBleHBsaWNpdCB1bnJlc29sdmVkIGVudHJ5IFx1MjAxNCBuZXZlciBhIGd1ZXNzZWQgd3JpdGUuXG4gKlxuICogVGhlIGdyZXAgZmFtaWx5IChncmVwIC1uLy1BLy1CLy1DKSBpcyBub3QgY2xhc3NpZmllZCBoZXJlIGVpdGhlcjogaXRzXG4gKiB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50IGFuZCBsaXZlcyBpblxuICogdGhlIHJlc3BvbnNlLCBub3QgdGhlIGNvbW1hbmQgdGV4dC4gVGhvc2Ugc3BhbnMgYXJlIHJlc3BvbnNlLWRlcml2ZWQgXHUyMDE0XG4gKiBgcGFyc2VSZXNwb25zZWAgaW4gLi9wYXJzZS1yZXNwb25zZS5qcyByZWFkcyB0aGVtIG91dCBvZiB0aGUgY29tbWFuZCdzXG4gKiBgdG9vbF9yZXNwb25zZWAuIFRoZSBgZ2l0IGxvZyAtTGAgLyBgZ2l0IHNob3cgcmV2OnBhdGhgIGlkaW9tcyBiZWxvdyByZW1haW5cbiAqIGNvbW1hbmQtdGV4dC1kZXJpdmVkLlxuICovXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgaXNBYnNvbHV0ZSwgam9pbiBhcyBqb2luUGF0aCwgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb3VudEZpbGVMaW5lcywgY291bnRHaXRCbG9iTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQge1xuICBhcmd2T2YsXG4gIHR5cGUgT3BlcmF0b3IsXG4gIHR5cGUgU2ltcGxlQ29tbWFuZCxcbiAgc3BsaXRUb3BMZXZlbCxcbiAgc3BsaXRXb3JkcyxcbiAgc3RyaXBMZWFkaW5nQXNzaWdubWVudHMsXG4gIHN0cmlwUmVkaXJlY3RzLFxuICBzdHJpcFdyYXBwZXJzLFxuICB0eXBlIFRva2VuLFxuICB0b2tlbml6ZVxufSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IHR5cGUgUGF0aFN0cmlwLCBwYXJzZVVuaWZpZWREaWZmUmFuZ2UgfSBmcm9tICcuL3VuaWZpZWQtZGlmZi5qcyc7XG5cbi8qKlxuICogVGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBraW5kIG9mIGEgcmVzb2x2ZWQgc3Bhbi4gVGhlIGFkYXB0ZXJzIHRyYW5zbGF0ZSBmcm9tXG4gKiB0aGlzLCBuZXZlciBmcm9tIGBpZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnYC1zdHlsZSBjaGVja3MgKHBsYW4gXHUwMEE3MSkuXG4gKi9cbmV4cG9ydCB0eXBlIE9wZXJhdGlvbiA9XG4gIHwgJ3JlYWQnIC8vIHJlYWQgaWRpb21zOyBjcC9pbnN0YWxsIHNvdXJjZSBvcGVyYW5kc1xuICB8ICdjcmVhdGUtb3ZlcndyaXRlJyAvLyB0cnVuY2F0aW5nIGNvbnRlbnQgd3JpdGVzOiA+IHJlZGlyZWN0cywgdGVlLCBoZXJlZG9jID4sIGNwL212IGRlc3QsIHJlc3RvcmUvY2hlY2tvdXQsIHBhdGNoIGFkZFxuICB8ICdhcHBlbmQnIC8vID4+IHJlZGlyZWN0cywgdGVlIC1hLCBoZXJlZG9jID4+XG4gIHwgJ21vZGlmeScgLy8gaW4tcGxhY2UgZWRpdHMgd2l0aCB1bmtub3duIGNvbnRlbnQ6IHNlZCAtaSwgcGF0Y2ggaHVua3MsIGZvcm1hdHRlciB3cml0ZSBmbGFnc1xuICB8ICdyZW5hbWUtY29weScgLy8gbXYvZ2l0IG12L3BhdGNoLXJlbmFtZSBkZXN0aW5hdGlvbiAod2hvbGUtZmlsZSB3cml0ZSwgc2FtZSB0b3VjaCBhcyBjcmVhdGUtb3ZlcndyaXRlKVxuICB8ICd0cnVuY2F0ZScgLy8gOiA+IGYsIGJhcmUgPiBmLCB0cnVuY2F0ZVxuICB8ICdkZWxldGUnOyAvLyBybSwgbXYvZ2l0IG12IHNvdXJjZSwgcGF0Y2ggZGVsZXRlXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRTcGFuIHtcbiAgb3BlcmF0aW9uOiBPcGVyYXRpb247XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogRXhhY3QgcmFuZ2U6IGV2ZXJ5IHJlYWQ7IG1vZGlmeSBvcGVyYXRpb25zIHdpdGggYSBzdGF0aWNhbGx5IGtub3duIHJhbmdlXG4gICAqIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsIHBhdGNoIGh1bmsgdW5pb25zKS4gQWJzZW50IGZvciB3cml0ZXMgXHUyMTkyXG4gICAqIHdob2xlLWZpbGUgc2NvcGUuXG4gICAqL1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTdGF0aWNhbGx5IGtub3duIHdyaXR0ZW4gY29udGVudCBcdTIwMTQgYXBwZW5kIGJvZGllcyBhbmQgbGl0ZXJhbCBvdmVyd3JpdGVcbiAgICogYm9kaWVzIChoZXJlZG9jL2VjaG8vcHJpbnRmL3RlZSBsaXRlcmFscywgcGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBPbiBhcHBlbmRzIGl0XG4gICAqIGlzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHk7IG9uIGBjcmVhdGUtb3ZlcndyaXRlYCBpdCBpcyB0aGUgZXhhY3QgZ2F0ZSdzXG4gICAqIHBvc3QtY29udGVudCBcdTIwMTQgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChgd3JpdHRlbjogJydgKSBlaXRoZXJcbiAgICogd2F5LlxuICAgKi9cbiAgd3JpdHRlbj86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXMgTmAgc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiB0aGVcbiAgICogXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IChgLXMgMGAgXHUyMTkyIHRoZSBlbXB0eSBnYXRlKS5cbiAgICogQWJzZW50IGZvciByZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSwgYC1yIHJlZmAsIGFuZCBldmVyeSBvdGhlclxuICAgKiBvcGVyYXRpb24gXHUyMDE0IHRob3NlIGdhdGUgZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzaXplPzogbnVtYmVyO1xuICAvKipcbiAgICogT3JkaW5hbCBvZiB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kIHdpdGhpbiB0aGUgY29tcG91bmQsIGluIHdhbGtlclxuICAgKiBvcmRlcjsgZ3JvdXBzIHRoZSBzcGFucyBvZiBvbmUgY29tbWFuZCBmb3Igam9pbiBnYXRpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICAgKi9cbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQ7IG9ubHkgYCcmJidgL2AnfHwnYCBnYXRlLlxuICAgKiBBYnNlbnQgZm9yIGBzdGFydGAvYDtgL25ld2xpbmUvYCZgL2B8YCBib3VuZGFyaWVzLlxuICAgKi9cbiAgam9pbj86ICcmJicgfCAnfHwnO1xuICBub3RlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnXG4gIC8vIFRoZSB3cml0ZS10b3VjaCBmYW1pbGllcyAocGxhbiBcdTAwQTc1KS4gSWRpb20gc3RheXMgbWF0Y2ggbWV0YWRhdGEgZm9yIHRlc3RzXG4gIC8vIGFuZCB1bnJlc29sdmVkIHJlYXNvbnM7IGFkYXB0ZXIgYmVoYXZpb3Iga2V5cyBvbiBgb3BlcmF0aW9uYCwgbmV2ZXIgaWRpb20uXG4gIHwgJ3JlZGlyZWN0LXdyaXRlJyAvLyBcdTAwQTc1LjE6IGVjaG8vcHJpbnRmL3RlZSBjb250ZW50IHJlZGlyZWN0c1xuICB8ICd0cnVuY2F0ZS13cml0ZScgLy8gXHUwMEE3NS4xOiBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0aW9uc1xuICB8ICdjcC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ2luc3RhbGwtd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdtdi13cml0ZScgLy8gXHUwMEE3NS40OiBtdiBhbmQgZ2l0IG12XG4gIHwgJ3JtLXdyaXRlJyAvLyBcdTAwQTc1LjU6IHJtIGFuZCBnaXQgcm1cbiAgfCAndHJ1bmNhdGUtY29tbWFuZCcgLy8gXHUwMEE3NS41OiB0aGUgdHJ1bmNhdGUgY29tbWFuZFxuICB8ICdzZWQtaW5wbGFjZScgLy8gXHUwMEE3NS42OiBzZWQgLWlcbiAgfCAncGF0Y2gtd3JpdGUnIC8vIFx1MDBBNzUuNzogcGF0Y2ggYW5kIGdpdCBhcHBseVxuICB8ICdmb3JtYXR0ZXItd3JpdGUnIC8vIFx1MDBBNzUuOFxuICB8ICdnaXQtcmVzdG9yZS13cml0ZScgLy8gXHUwMEE3NS45OiBnaXQgcmVzdG9yZSBwYXRoc3BlY3NcbiAgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJzsgLy8gXHUwMEE3NS45OiBnaXQgY2hlY2tvdXQgLS0gcGF0aHNwZWNzXG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHtcbiAgICAgIC8qKlxuICAgICAgICogQSBzcGFuLWxlc3MgY29tbWFuZCB3aXRoIGEgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBcdTIwMTQgYGZhbHNlYCAoMSksXG4gICAgICAgKiBgdHJ1ZWAgKDApLCBgOmAgKDApLiBObyBzcGFuIGFuZCBubyB0b3VjaCwgYnV0IHRoZSBqb2luIGRyaXZlciBuZWVkc1xuICAgICAgICogdGhlIHZlcmRpY3Q6IGBmYWxzZSAmJiBlY2hvIHggPiBmYCBza2lwcyB0aGUgZWNobywgYHRydWUgfHwgZWNobyB4ID5cbiAgICAgICAqIGZgIHNraXBzIGl0IHRvbywgYW5kIHdpdGhvdXQgdGhlIGd1YXJkIGJvdGggd291bGQgZmlyZSBhbiBleGFjdC1nYXRlXG4gICAgICAgKiB0b3VjaCBmb3IgYSB3cml0ZSB0aGF0IG5ldmVyIHJhbiAocGxhbiBcdTAwQTczIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZFxuICAgICAgICogcnVsZSkuIEZpbHRlcmVkIG91dCBvZiBgcGFyc2VDb21tYW5kYCdzIHNwYW4gbGlzdCB3aXRoIHRoZVxuICAgICAgICogdW5yZXNvbHZlZHMuXG4gICAgICAgKi9cbiAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnO1xuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gICAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXTtcbiAgICAgIGV4aXRTdGF0dXM6IDAgfCAxO1xuICAgIH07XG5cbi8qKiBPcHRpb25zIGZvciB0aGUgQmFzaCBjb21tYW5kIHBhcnNlciAocGxhbiBcdTAwQTc4KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VPcHRpb25zIHtcbiAgLyoqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0byByZXNvbHZlIHJlbGF0aXZlIHBhdGhzIGFnYWluc3Q7IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYC4gKi9cbiAgY3dkPzogc3RyaW5nO1xuICAvKiogVGhlIGhvb2sgcHJvY2VzcyBlbnYsIGZvciBhbGxvd2xpc3RlZCBwYXRoLXZhcmlhYmxlIHJlc29sdXRpb247IGRlZmF1bHRzIHRvIGBwcm9jZXNzLmVudmAuICovXG4gIGVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD47XG4gIC8qKiBWYXJpYWJsZSBuYW1lcyBhbGxvd2VkIHRvIHJlc29sdmUgZnJvbSBgZW52YDsgZGVmYXVsdHMgdG8gYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgLiAqL1xuICBhbGxvd2xpc3Q/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIFdoZXRoZXIgYSBzaW1wbGUgY29tbWFuZCBpcyBrbm93biB0byBoYXZlIGV4ZWN1dGVkLCBwcm92YWJseSBub3QsIG9yIHVuZGV0ZXJtaW5hYmxlIChwbGFuIFx1MDBBNzIpLiAqL1xuZXhwb3J0IHR5cGUgRXhlY1N0YXR1cyA9ICd5ZXMnIHwgJ25vJyB8ICd1bmtub3duJztcblxuLyoqIFRoZSBleGVjdXRpb24tYXdhcmUgd2FsaydzIHZlcmRpY3QgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTcyKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhZ2VFeGVjIHtcbiAgLyoqIGAneWVzJ2AgXHUyMDE0IHByb3ZhYmx5IGV4ZWN1dGVkOyBgJ25vJ2AgXHUyMDE0IHByb3ZhYmx5IG5vdDsgYCd1bmtub3duJ2AgXHUyMDE0IHVuZGV0ZXJtaW5hYmxlIChmYWlsIGNsb3NlZCkuICovXG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG59XG5cbi8qKlxuICogQ29tcHV0ZSwgcGVyIHNpbXBsZSBjb21tYW5kLCB3aGV0aGVyIGl0IGV4ZWN1dGVkIChwbGFuIFx1MDBBNzIpOiBwaXBlbGluZVxuICogZ3JvdXBpbmcsIGAmJmAvYHx8YCBjaGFpbiBnYXRpbmcgYWdhaW5zdCBrbm93biBzdGF0dXNlcywgYCFgIGdyb3VwLWxldmVsXG4gKiBuZWdhdGlvbiwgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIHRlcm1pbmF0b3IgYW5kIG5ldmVyLXJldHVyblxuICogZmlyZXMsIGFuZCB0aGUgZGVjaWRhYmxlLWNvbnRyb2wgY29uc3RydWN0IGNsYXNzZXMuIElPLWZyZWUgYW5kIGV4cG9ydGVkIHNvXG4gKiB0aGUgeHRyYWNlIG9yYWNsZSBjYW4gY29tcGFyZSBleGVjdXRlZCBzZXRzIGFnYWluc3QgcmVhbCBiYXNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZUV4ZWN1dGlvbihzaW1wbGVDb21tYW5kczogU2ltcGxlQ29tbWFuZFtdLCBfb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBTdGFnZUV4ZWNbXSB7XG4gIGNvbnN0IHdhbGtlciA9IG5ldyBFeGVjdXRpb25XYWxrZXIoKTtcbiAgd2Fsa2VyLndhbGtJbnB1dChzaW1wbGVDb21tYW5kcyk7XG4gIHJldHVybiB3YWxrZXIudmVyZGljdHMubWFwKChleGVjKSA9PiAoeyBleGVjIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeGVjdXRpb24gd2FsayAocGxhbiBcdTAwQTcyKTogcGVyLXNpbXBsZS1jb21tYW5kIEV4ZWNTdGF0dXMsIGRyaXZlbiBieSBwaXBlbGluZVxuLy8gZ3JvdXBpbmcsICYmL3x8IGNoYWluIHN0YXR1cywgaW4tc3RyaW5nIGVycmV4aXQvcGlwZWZhaWwgbGl2ZW5lc3MsIGFuZCB0aGVcbi8vIGRlY2lkYWJsZS1jb250cm9sIGNvbnN0cnVjdCBjbGFzc2VzLiBUaGUgd2FsayBhbHNvIGV4cGFuZHMgZGVjaWRhYmxlXG4vLyBjb25zdHJ1Y3QgaW50ZXJpb3JzIGludG8gdGhlIHN0YWdlIHN0cmVhbSB0aGUgZW1pc3Npb24gcmVwbGF5IGNvbnN1bWVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgQ2hhaW5TdGF0dXMgPSAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bic7XG5cbnR5cGUgRGVhZEtpbmQgPSAnZXhpdCcgfCAnbmV2ZXItcmV0dXJuJyB8ICdlcnJleGl0JyB8ICdtYWxmb3JtZWQnO1xuXG4vKiogT25lIHN0YWdlIHRoZSB3YWxrIGNvbnRyaWJ1dGVzIHRvIHRoZSBlbWlzc2lvbiByZXBsYXkuICovXG5pbnRlcmZhY2UgRXhwYW5kZWRTdGFnZSB7XG4gIHRleHQ6IHN0cmluZztcbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG4gIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gIC8qKiBBIG1lbWJlciBvZiBhIG11bHRpLW1lbWJlciBwaXBlbGluZTogc2lkZSBlZmZlY3RzIGFuZCBgZXhpdGAvYGV4ZWNgIHRlcm1pbmF0b3JzIGFyZSBzdXBwcmVzc2VkLiAqL1xuICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAvKiogVGhlIGVtaXNzaW9uJ3MgYGNkYCBmcmFtZTogKzEgaW5zaWRlIGEgc3Vic2hlbGwgaW50ZXJpb3IsIGRpc2NhcmRlZCBhdCB0aGUgY2xvc2UuICovXG4gIGRpckZyYW1lOiBudW1iZXI7XG4gIC8qKiBUaGUgc2NyaXB0IHZhcmlhYmxlIHRhYmxlIGFzIG9mIHRoaXMgc3RhZ2UgKHBsYW4gXHUwMEE3Nyk6IHRoZSBleGVjdXRlZCBub24tcGlwZSBhc3NpZ25tZW50cyBzZWVuIHNvIGZhciwgaW4gb3JkZXIuICovXG4gIGFzc2lnbm1lbnRzOiBSZWFkb25seU1hcDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmludGVyZmFjZSBMb29wRnJhbWUge1xuICBvdXRjb21lOiAnbm9uZScgfCAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdhbWJpZ3VvdXMnIHwgJ3JldHVybic7XG4gIC8qKiBBIGRlY2lzaXZlIG93bi1kZXB0aCBicmVhay9jb250aW51ZSBmaXJlZDogdGhlIHJlc3Qgb2YgdGhlIGJvZHkgbGlzdCBpcyBkZWFkLiAqL1xuICBib2R5VGVybWluYXRlZDogYm9vbGVhbjtcbiAgLyoqIEEgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIG1hZGUgdGhlIGd1YXJkIG9ud2FyZCB1bnRvdWNoYWJsZS4gKi9cbiAgYW1iaWd1b3VzU3RvcDogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFdhbGtPcHRpb25zIHtcbiAgLyoqIEVycmV4aXQgbGl2ZW5lc3MgaXMgc3VzcGVuZGVkIGluc2lkZSBpZi93aGlsZS91bnRpbCBjb25kaXRpb25zIChiYXNoIGV4ZW1wdHMgdGhlbSkuICovXG4gIGxpdmVuZXNzOiBib29sZWFuO1xuICAvKiogVGhlIGV4cGFuZGVkIHN0YWdlIHN0cmVhbSBpcyBkaXNjYXJkZWQgKGNvbmRpdGlvbnMsIHNjYW5zLCBkZWYtYm9keSBwcm9iZXMpLiAqL1xuICBkaXNjYXJkOiBib29sZWFuO1xuICAvKiogU2lkZSBlZmZlY3RzIChhc3NpZ25tZW50cywgc2V0IHRvZ2dsZXMsIGRlZiByZWdpc3RyYXRpb24pIGFyZSBhcHBsaWVkLiAqL1xuICBzaWRlRWZmZWN0czogYm9vbGVhbjtcbiAgLyoqIFRoaXMgbGlzdCBpcyB0aGUgdG9wLWxldmVsIGlucHV0OiByZWNvcmQgdGhlIHBlci1pbnB1dCB2ZXJkaWN0cy4gKi9cbiAgaW5wdXRGYWNpbmc6IGJvb2xlYW47XG59XG5cbmNvbnN0IEFTU0lHTk1FTlRfUkUgPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqIFRoZSBgLW9gL2Arb2Agb3B0aW9uIG5hbWVzIG9mIGBzZXRgIHRoYXQgYmFzaCBkb2N1bWVudHMgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX09QVElPTl9OQU1FUyA9IG5ldyBTZXQoW1xuICAnYWxsZXhwb3J0JyxcbiAgJ2JyYWNlZXhwYW5kJyxcbiAgJ2VtYWNzJyxcbiAgJ2VycmV4aXQnLFxuICAnZXJydHJhY2UnLFxuICAnZnVuY3RyYWNlJyxcbiAgJ2hhc2hhbGwnLFxuICAnaGlzdGV4cGFuZCcsXG4gICdoaXN0b3J5JyxcbiAgJ2lnbm9yZWVvZicsXG4gICdpbnRlcmFjdGl2ZS1jb21tZW50cycsXG4gICdrZXl3b3JkJyxcbiAgJ2xleGljYWwtd29yZC1wcm9jZXNzaW5nJyxcbiAgJ21vbml0b3InLFxuICAnbm9jbG9iYmVyJyxcbiAgJ25vZXhlYycsXG4gICdub2dsb2InLFxuICAnbm9sb2cnLFxuICAnbm90aWZ5JyxcbiAgJ25vdW5zZXQnLFxuICAnb25lY21kJyxcbiAgJ3BoeXNpY2FsJyxcbiAgJ3BpcGVmYWlsJyxcbiAgJ3Bvc2l4JyxcbiAgJ3ByaXZpbGVnZWQnLFxuICAndmVyYm9zZScsXG4gICd2aScsXG4gICd4dHJhY2UnXG5dKTtcblxuLyoqIGJhc2gncyBkb2N1bWVudGVkIHNpbmdsZS1sZXR0ZXIgYHNldGAgZmxhZ3MgKHBsYW4gXHUwMEE3Miwga25vd24gc3RhdHVzZXMpLiAqL1xuY29uc3QgU0VUX0ZMQUdfTEVUVEVSUyA9ICdhQmJDZUVmaEhpa21ub3BQdFR1dngnO1xuXG4vKiogQnVpbHRpbnMgdGhlIHdhbGsncyByZXN0cmljdGVkIGBidWlsdGluYCB3cmFwcGVyIHN0cmlwIGZvcndhcmRzIChwbGFuIFx1MDBBNzIsIHdyYXBwZXIgZGlzY2lwbGluZSkuICovXG5jb25zdCBSRUNPR05JWkVEX0JVSUxUSU5TID0gbmV3IFNldChbXG4gICd0cnVlJyxcbiAgJzonLFxuICAnZmFsc2UnLFxuICAnc2V0JyxcbiAgJ2V4aXQnLFxuICAnZXhlYycsXG4gICdyZXR1cm4nLFxuICAnYnJlYWsnLFxuICAnY29udGludWUnLFxuICAnY2QnLFxuICAnZXhwb3J0JyxcbiAgJ2NvbW1hbmQnLFxuICAnYnVpbHRpbidcbl0pO1xuXG4vKiogV2Fsay1zaWRlIHdyYXBwZXIgc3RyaXA6IGAhYCwgYGNvbW1hbmRgLCBhbmQgYGJ1aWx0aW5gIChyZXN0cmljdGVkIHRvIHRoZSByZWNvZ25pemVkIGJ1aWx0aW5zKS4gKi9cbmZ1bmN0aW9uIHdhbGtTdHJpcChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICchJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdjb21tYW5kJykgaSsrO1xuICB3aGlsZSAoaSA8IGFyZ3YubGVuZ3RoICYmIGFyZ3ZbaV0gPT09ICdidWlsdGluJyAmJiBhcmd2W2kgKyAxXSAhPT0gdW5kZWZpbmVkICYmIFJFQ09HTklaRURfQlVJTFRJTlMuaGFzKGFyZ3ZbaSArIDFdKSlcbiAgICBpKys7XG4gIHJldHVybiBhcmd2LnNsaWNlKGkpO1xufVxuXG4vKiogRXZlcnkgYXJnIGEgcmVjb2duaXplZCBgc2V0YCBmbGFnIGdyb3VwIChgLW9gIGNvbnN1bWVzIGl0cyBuYW1lKSwgYC0tYCwgb3IgYSBwb3NpdGlvbmFsIHdvcmQuICovXG5mdW5jdGlvbiBzZXRGbGFnc0tub3duKGFyZ3M6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhID09PSAnLS0nKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgfHwgYS5zdGFydHNXaXRoKCcrJykpIHtcbiAgICAgIGNvbnN0IGNoYXJzID0gYS5zbGljZSgxKTtcbiAgICAgIGlmIChjaGFycy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY2hhcnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgY29uc3QgYyA9IGNoYXJzW2tdO1xuICAgICAgICBpZiAoYyA9PT0gJ28nKSB7XG4gICAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbaSArIDFdO1xuICAgICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQgfHwgIVNFVF9PUFRJT05fTkFNRVMuaGFzKG5hbWUpKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgaSsrO1xuICAgICAgICB9IGVsc2UgaWYgKCFTRVRfRkxBR19MRVRURVJTLmluY2x1ZGVzKGMpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEEgcG9zaXRpb25hbCBwYXJhbWV0ZXIgd29yZCBcdTIwMTQgYHNldCBmb29gIGV4aXRzIDAuXG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogQSBxdW90ZS1hd2FyZSBzY2FuIG9mIGEgY29uc3RydWN0J3MgdGV4dCB0aGF0IHlpZWxkcyBpdHMgd29yZHMgKHF1b3RlXG4gKiBjb250ZW50IHN0cmlwcGVkKSB3aXRoIHRoZSBwYXJlbi9icmFjZS9jb25zdHJ1Y3QgZGVwdGhzIGF0IGVhY2ggd29yZCwgc29cbiAqIGB0aGVuYC9gZG9gL2Bkb25lYC9gZmlgL2Blc2FjYC9gaW5gIGtleXdvcmRzIGFyZSByZWNvZ25pemVkIG9ubHkgYXQgdGhlXG4gKiBsZXZlbCB0aGF0IG93bnMgdGhlbS5cbiAqL1xuaW50ZXJmYWNlIFdvcmRUb2sge1xuICB3b3JkOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xuICBkZXB0aDogbnVtYmVyO1xuICBicmFjZURlcHRoOiBudW1iZXI7XG4gIGNvbnN0cnVjdERlcHRoOiBudW1iZXI7XG4gIHF1b3RlZDogYm9vbGVhbjtcbn1cblxuY29uc3QgQ09OU1RSVUNUX09QRU5FUlMgPSBuZXcgU2V0KFsnaWYnLCAnd2hpbGUnLCAndW50aWwnLCAnZm9yJywgJ2Nhc2UnLCAnc2VsZWN0J10pO1xuY29uc3QgQ09OU1RSVUNUX0NMT1NFUlMgPSBuZXcgU2V0KFsnZmknLCAnZG9uZScsICdlc2FjJ10pO1xuXG5mdW5jdGlvbiBzY2FuVG9rZW5zKHRleHQ6IHN0cmluZyk6IFdvcmRUb2tbXSB7XG4gIGNvbnN0IHRva3M6IFdvcmRUb2tbXSA9IFtdO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgbGV0IHBhcmVuRGVwdGggPSAwO1xuICBsZXQgYnJhY2VEZXB0aCA9IDA7XG4gIGxldCBjb25zdHJ1Y3REZXB0aCA9IDA7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSB0ZXh0W2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJyB8fCBjID09PSAneycpIHtcbiAgICAgIGlmIChjID09PSAnKCcpIHBhcmVuRGVwdGgrKztcbiAgICAgIGVsc2UgYnJhY2VEZXB0aCsrO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScgfHwgYyA9PT0gJ30nKSB7XG4gICAgICBpZiAoYyA9PT0gJyknKSBwYXJlbkRlcHRoID0gTWF0aC5tYXgoMCwgcGFyZW5EZXB0aCAtIDEpO1xuICAgICAgZWxzZSBicmFjZURlcHRoID0gTWF0aC5tYXgoMCwgYnJhY2VEZXB0aCAtIDEpO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgnOyZ8PD4nLmluY2x1ZGVzKGMpKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3Qgc3RhcnQgPSBpO1xuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ID09PSBudWxsKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaSA9IHcuZW5kO1xuICAgIHRva3MucHVzaCh7IHdvcmQ6IHcud29yZCwgc3RhcnQsIGVuZDogdy5lbmQsIGRlcHRoOiBwYXJlbkRlcHRoLCBicmFjZURlcHRoLCBjb25zdHJ1Y3REZXB0aCwgcXVvdGVkOiB3LnF1b3RlZCB9KTtcbiAgICBpZiAocGFyZW5EZXB0aCA9PT0gMCAmJiBicmFjZURlcHRoID09PSAwICYmICF3LnF1b3RlZCkge1xuICAgICAgaWYgKENPTlNUUlVDVF9PUEVORVJTLmhhcyh3LndvcmQpKSBjb25zdHJ1Y3REZXB0aCsrO1xuICAgICAgZWxzZSBpZiAoQ09OU1RSVUNUX0NMT1NFUlMuaGFzKHcud29yZCkpIGNvbnN0cnVjdERlcHRoID0gTWF0aC5tYXgoMCwgY29uc3RydWN0RGVwdGggLSAxKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRva3M7XG59XG5cbi8qKiBSZWFkIG9uZSB3b3JkIGF0IGBpYCAocXVvdGUtYXdhcmUsIHNlcGFyYXRvci10ZXJtaW5hdGVkKTsgcmV0dXJucyBpdHMgY29udGVudCBhbmQgc3Bhbi4gKi9cbmZ1bmN0aW9uIHJlYWRXb3JkQXQodGV4dDogc3RyaW5nLCBpOiBudW1iZXIpOiB7IHdvcmQ6IHN0cmluZzsgZW5kOiBudW1iZXI7IHF1b3RlZDogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGlmIChpID49IHRleHQubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgbGV0IHdvcmQgPSAnJztcbiAgbGV0IHF1b3RlZCA9IGZhbHNlO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIHdoaWxlIChpIDwgbiAmJiAhL1xccy8udGVzdCh0ZXh0W2ldKSAmJiAhJygpe307Jnw8PicuaW5jbHVkZXModGV4dFtpXSkpIHtcbiAgICBjb25zdCBjaCA9IHRleHRbaV07XG4gICAgaWYgKGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGkrKztcbiAgICAgIHdoaWxlIChpIDwgbiAmJiB0ZXh0W2ldICE9PSBcIidcIikge1xuICAgICAgICB3b3JkICs9IHRleHRbaV07XG4gICAgICAgIGkrKztcbiAgICAgIH1cbiAgICAgIGlmIChpIDwgbikgaSsrO1xuICAgIH0gZWxzZSBpZiAoY2ggPT09ICdcIicpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgICB3aGlsZSAoaSA8IG4gJiYgdGV4dFtpXSAhPT0gJ1wiJykge1xuICAgICAgICBpZiAodGV4dFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbaSArIDFdKSkge1xuICAgICAgICAgIHdvcmQgKz0gdGV4dFtpICsgMV07XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHdvcmQgKz0gdGV4dFtpXTtcbiAgICAgICAgICBpKys7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpIDwgbikgaSsrO1xuICAgIH0gZWxzZSBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIHdvcmQgKz0gdGV4dFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIHdvcmQgKz0gY2g7XG4gICAgICBpKys7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHdvcmQsIGVuZDogaSwgcXVvdGVkIH07XG59XG5cbi8qKiBUaGUgaW50ZXJpb3IgYmV0d2VlbiB0aGUgZmlyc3QgYG9wZW5gIGNoYXIgYW5kIGl0cyBtYXRjaGluZyBgY2xvc2VgLCBxdW90ZXMgYXdhcmUuICovXG5mdW5jdGlvbiBleHRyYWN0R3JvdXBCb2R5KHRleHQ6IHN0cmluZywgb3BlbjogJ3snIHwgJygnLCBjbG9zZTogJ30nIHwgJyknKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHN0YXJ0ID0gdGV4dC5pbmRleE9mKG9wZW4pO1xuICBpZiAoc3RhcnQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBwID0gc3RhcnQ7IHAgPCB0ZXh0Lmxlbmd0aDsgcCsrKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgdGV4dC5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W3AgKyAxXSkpIHArKztcbiAgICAgIGVsc2UgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICBpblF1b3RlID0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgIHArKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09IG9wZW4pIGRlcHRoKys7XG4gICAgZWxzZSBpZiAoY2ggPT09IGNsb3NlKSB7XG4gICAgICBkZXB0aC0tO1xuICAgICAgaWYgKGRlcHRoID09PSAwKSByZXR1cm4gdGV4dC5zbGljZShzdGFydCArIDEsIHApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxudHlwZSBDb25zdHJ1Y3RLaW5kID0gJ2lmJyB8ICd3aGlsZScgfCAndW50aWwnIHwgJ2ZvcicgfCAnY2FzZScgfCAnc2VsZWN0JyB8ICdicmFjZScgfCAnc3Vic2hlbGwnIHwgJ2RlZicgfCAncGxhaW4nO1xuXG5mdW5jdGlvbiBjbGFzc2lmeVN0YWdlKHRleHQ6IHN0cmluZyk6IENvbnN0cnVjdEtpbmQge1xuICBjb25zdCB0ID0gdGV4dC50cmltU3RhcnQoKTtcbiAgaWYgKHQuc3RhcnRzV2l0aCgneycpKSByZXR1cm4gJ2JyYWNlJztcbiAgaWYgKHQuc3RhcnRzV2l0aCgnKCcpKSByZXR1cm4gJ3N1YnNoZWxsJztcbiAgY29uc3Qga3cgPSB0Lm1hdGNoKC9eKGlmfHdoaWxlfHVudGlsfGZvcnxjYXNlfHNlbGVjdClcXGIvKTtcbiAgaWYgKGt3ICE9PSBudWxsKSByZXR1cm4ga3dbMV0gYXMgQ29uc3RydWN0S2luZDtcbiAgaWYgKC9eKD86ZnVuY3Rpb25cXHMrKT9bQS1aYS16X11bQS1aYS16MC05X10qXFwoXFwpXFxzKlxcey8udGVzdCh0KSkgcmV0dXJuICdkZWYnO1xuICByZXR1cm4gJ3BsYWluJztcbn1cblxuLyoqIEEgZnVuY3Rpb24gZGVmaW5pdGlvbidzIG5hbWUgYW5kIGJvZHkgdGV4dCAoYnJhY2UtZ3JvdXAgaW50ZXJpb3IpLiAqL1xuZnVuY3Rpb24gcGFyc2VEZWYodGV4dDogc3RyaW5nKTogeyBuYW1lOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IG0gPSB0ZXh0Lm1hdGNoKC9eKD86ZnVuY3Rpb25cXHMrKT8oW0EtWmEtel9dW0EtWmEtejAtOV9dKilcXHMqKD86XFwoXFwpKT9cXHMqXFx7Lyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYm9keSA9IGV4dHJhY3RHcm91cEJvZHkodGV4dCwgJ3snLCAnfScpO1xuICBpZiAoYm9keSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IG5hbWU6IG1bMV0sIGJvZHkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZElmIHtcbiAgY29uZGl0aW9uOiBzdHJpbmc7XG4gIHRoZW5Cb2R5OiBzdHJpbmc7XG4gIGVsaWZzOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdO1xuICBlbHNlQm9keTogc3RyaW5nIHwgbnVsbDtcbn1cblxuZnVuY3Rpb24gcGFyc2VJZih0ZXh0OiBzdHJpbmcpOiBQYXJzZWRJZiB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0gJ2lmJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRoZW5JZHggPSB0b2tzLmZpbmRJbmRleCgodCkgPT4gdC53b3JkID09PSAndGhlbicgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmICh0aGVuSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRoZW5Ub2sgPSB0b2tzW3RoZW5JZHhdO1xuICBjb25zdCBjb25kaXRpb24gPSB0ZXh0LnNsaWNlKHRva3NbMF0uZW5kLCB0aGVuVG9rLnN0YXJ0KTtcblxuICBjb25zdCBib3VuZGFyaWVzOiB7IHdvcmQ6IHN0cmluZzsgdG9rOiBXb3JkVG9rIH1bXSA9IFtdO1xuICBmb3IgKGxldCBpZHggPSB0aGVuSWR4ICsgMTsgaWR4IDwgdG9rcy5sZW5ndGg7IGlkeCsrKSB7XG4gICAgY29uc3QgdCA9IHRva3NbaWR4XTtcbiAgICBpZiAodC5jb25zdHJ1Y3REZXB0aCAhPT0gMSB8fCAodC53b3JkICE9PSAnZWxpZicgJiYgdC53b3JkICE9PSAnZWxzZScgJiYgdC53b3JkICE9PSAnZmknKSkgY29udGludWU7XG4gICAgaWYgKHQud29yZCA9PT0gJ2VsaWYnKSB7XG4gICAgICBjb25zdCBlVGhlbklkeCA9IHRva3MuZmluZEluZGV4KCh0dCwgaWkpID0+IGlpID4gaWR4ICYmIHR0LndvcmQgPT09ICd0aGVuJyAmJiB0dC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gICAgICBpZiAoZVRoZW5JZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6ICdlbGlmJywgdG9rOiB0IH0sIHsgd29yZDogJ3RoZW4nLCB0b2s6IHRva3NbZVRoZW5JZHhdIH0pO1xuICAgICAgaWR4ID0gZVRoZW5JZHg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogdC53b3JkLCB0b2s6IHQgfSk7XG4gICAgaWYgKHQud29yZCA9PT0gJ2Vsc2UnKSB7XG4gICAgICBjb25zdCBmaUlkeCA9IHRva3MuZmluZEluZGV4KCh0dCwgaWkpID0+IGlpID4gaWR4ICYmIHR0LndvcmQgPT09ICdmaScgJiYgdHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICAgICAgaWYgKGZpSWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiAnZmknLCB0b2s6IHRva3NbZmlJZHhdIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGJyZWFrO1xuICB9XG4gIGlmIChib3VuZGFyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgdGhlbkJvZHkgPSB0ZXh0LnNsaWNlKHRoZW5Ub2suZW5kLCBib3VuZGFyaWVzWzBdLnRvay5zdGFydCk7XG4gIGNvbnN0IGVsaWZzOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdID0gW107XG4gIGxldCBlbHNlQm9keTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGIgPSAwOyBiIDwgYm91bmRhcmllcy5sZW5ndGg7IGIrKykge1xuICAgIGNvbnN0IHsgd29yZCwgdG9rIH0gPSBib3VuZGFyaWVzW2JdO1xuICAgIGlmICh3b3JkID09PSAnZWxpZicpIHtcbiAgICAgIGNvbnN0IGVUaGVuID0gYm91bmRhcmllc1tiICsgMV07XG4gICAgICBpZiAoZVRoZW4gPT09IHVuZGVmaW5lZCB8fCBlVGhlbi53b3JkICE9PSAndGhlbicpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgbmV4dFN0YXJ0ID0gYm91bmRhcmllc1tiICsgMl0/LnRvay5zdGFydCA/PyB0ZXh0Lmxlbmd0aDtcbiAgICAgIGVsaWZzLnB1c2goeyBjb25kaXRpb246IHRleHQuc2xpY2UodG9rLmVuZCwgZVRoZW4udG9rLnN0YXJ0KSwgYm9keTogdGV4dC5zbGljZShlVGhlbi50b2suZW5kLCBuZXh0U3RhcnQpIH0pO1xuICAgICAgYisrO1xuICAgIH0gZWxzZSBpZiAod29yZCA9PT0gJ2Vsc2UnKSB7XG4gICAgICBjb25zdCBmaSA9IGJvdW5kYXJpZXNbYiArIDFdO1xuICAgICAgaWYgKGZpID09PSB1bmRlZmluZWQgfHwgZmkud29yZCAhPT0gJ2ZpJykgcmV0dXJuIG51bGw7XG4gICAgICBlbHNlQm9keSA9IHRleHQuc2xpY2UodG9rLmVuZCwgZmkudG9rLnN0YXJ0KTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBjb25kaXRpb24sIHRoZW5Cb2R5LCBlbGlmcywgZWxzZUJvZHkgfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VMb29wKHRleHQ6IHN0cmluZywga2V5d29yZDogJ3doaWxlJyB8ICd1bnRpbCcpOiB7IGNvbmRpdGlvbjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0ga2V5d29yZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LndvcmQgPT09ICdkbycgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb1RvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZG9uZVRvayA9IHRva3MuZmluZCgodCkgPT4gdC5zdGFydCA+IGRvVG9rLmVuZCAmJiB0LndvcmQgPT09ICdkb25lJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgaWYgKGRvbmVUb2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IGNvbmRpdGlvbjogdGV4dC5zbGljZSh0b2tzWzBdLmVuZCwgZG9Ub2suc3RhcnQpLCBib2R5OiB0ZXh0LnNsaWNlKGRvVG9rLmVuZCwgZG9uZVRvay5zdGFydCkgfTtcbn1cblxuaW50ZXJmYWNlIFBhcnNlZEZvciB7XG4gIGxpc3Q6IHN0cmluZ1tdIHwgbnVsbDtcbiAgYm9keTogc3RyaW5nO1xuICB3aG9sZUludGVyaW9yOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRm9yKHRleHQ6IHN0cmluZyk6IFBhcnNlZEZvciB8IG51bGwge1xuICBjb25zdCB0b2tzID0gc2NhblRva2Vucyh0ZXh0KTtcbiAgaWYgKHRva3MubGVuZ3RoID09PSAwIHx8IHRva3NbMF0ud29yZCAhPT0gJ2ZvcicpIHJldHVybiBudWxsO1xuICBjb25zdCBuYW1lVG9rID0gdG9rc1sxXTtcbiAgaWYgKG5hbWVUb2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LndvcmQgPT09ICdkbycgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSAmJiB0LnN0YXJ0ID4gbmFtZVRvay5lbmQpO1xuICBpZiAoZG9Ub2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRvbmVUb2sgPSB0b2tzLmZpbmQoKHQpID0+IHQuc3RhcnQgPiBkb1Rvay5lbmQgJiYgdC53b3JkID09PSAnZG9uZScgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gIGlmIChkb25lVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBpblRvayA9IHRva3MuZmluZChcbiAgICAodCkgPT4gdC5zdGFydCA+IG5hbWVUb2suZW5kICYmIHQuc3RhcnQgPCBkb1Rvay5zdGFydCAmJiB0LndvcmQgPT09ICdpbicgJiYgdC5jb25zdHJ1Y3REZXB0aCA9PT0gMVxuICApO1xuICBsZXQgbGlzdDogc3RyaW5nW10gfCBudWxsID0gbnVsbDtcbiAgaWYgKGluVG9rICE9PSB1bmRlZmluZWQpIHtcbiAgICBsaXN0ID0gdG9rcy5maWx0ZXIoKHQpID0+IHQuc3RhcnQgPiBpblRvay5lbmQgJiYgdC5zdGFydCA8IGRvVG9rLnN0YXJ0KS5tYXAoKHQpID0+IHQud29yZCk7XG4gIH1cbiAgcmV0dXJuIHsgbGlzdCwgYm9keTogdGV4dC5zbGljZShkb1Rvay5lbmQsIGRvbmVUb2suc3RhcnQpLCB3aG9sZUludGVyaW9yOiB0ZXh0LnNsaWNlKG5hbWVUb2suZW5kLCBkb25lVG9rLnN0YXJ0KSB9O1xufVxuXG5pbnRlcmZhY2UgUGFyc2VkQ2FzZSB7XG4gIHN1YmplY3Q6IHN0cmluZztcbiAgYnJhbmNoZXM6IHsgcGF0dGVybjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdO1xuICBmYWxsdGhyb3VnaDogYm9vbGVhbjtcbn1cblxuZnVuY3Rpb24gcGFyc2VDYXNlKHRleHQ6IHN0cmluZyk6IFBhcnNlZENhc2UgfCBudWxsIHtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGNvbnN0IHNraXBXcyA9ICgpID0+IHtcbiAgICB3aGlsZSAoaSA8IG4gJiYgL1xccy8udGVzdCh0ZXh0W2ldKSkgaSsrO1xuICB9O1xuICBza2lwV3MoKTtcbiAgY29uc3QgbGVhZCA9IHJlYWRXb3JkQXQodGV4dCwgaSk7XG4gIGlmIChsZWFkID09PSBudWxsIHx8IGxlYWQud29yZCAhPT0gJ2Nhc2UnKSByZXR1cm4gbnVsbDtcbiAgaSA9IGxlYWQuZW5kO1xuXG4gIC8vIFRoZSBzdWJqZWN0IHdvcmRzIHVwIHRvIHRoZSBgaW5gIGF0IHBhcmVuIGRlcHRoIDAgKHF1b3RlIGNvbnRlbnQgb25seSkuXG4gIGxldCBwYXJlbkRlcHRoID0gMDtcbiAgY29uc3Qgc3ViamVjdFdvcmRzOiBzdHJpbmdbXSA9IFtdO1xuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBza2lwV3MoKTtcbiAgICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjID0gdGV4dFtpXTtcbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBwYXJlbkRlcHRoKys7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgcGFyZW5EZXB0aCA9IE1hdGgubWF4KDAsIHBhcmVuRGVwdGggLSAxKTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoJzsmfDw+Jy5pbmNsdWRlcyhjKSkge1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ID09PSBudWxsKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaSA9IHcuZW5kO1xuICAgIGlmIChwYXJlbkRlcHRoID09PSAwICYmICF3LnF1b3RlZCAmJiB3LndvcmQgPT09ICdpbicpIGJyZWFrO1xuICAgIHN1YmplY3RXb3Jkcy5wdXNoKHcud29yZCk7XG4gIH1cbiAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYnJhbmNoZXM6IHsgcGF0dGVybjogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVtdID0gW107XG4gIGxldCBmYWxsdGhyb3VnaCA9IGZhbHNlO1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIHNraXBXcygpO1xuICAgIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHcgPSByZWFkV29yZEF0KHRleHQsIGkpO1xuICAgIGlmICh3ICE9PSBudWxsICYmICF3LnF1b3RlZCAmJiB3LndvcmQgPT09ICdlc2FjJykge1xuICAgICAgcmV0dXJuIHsgc3ViamVjdDogc3ViamVjdFdvcmRzLmpvaW4oJyAnKSwgYnJhbmNoZXMsIGZhbGx0aHJvdWdoIH07XG4gICAgfVxuICAgIC8vIFRoZSBwYXR0ZXJuOiBldmVyeXRoaW5nIHVwIHRvIHRoZSBgKWAgYXQgcGFyZW4gZGVwdGggMC5cbiAgICBsZXQgcGF0RW5kID0gLTE7XG4gICAge1xuICAgICAgbGV0IHAgPSBpO1xuICAgICAgbGV0IGRlcHRoID0gMDtcbiAgICAgIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIHdoaWxlIChwIDwgbikge1xuICAgICAgICBjb25zdCBjaCA9IHRleHRbcF07XG4gICAgICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W3AgKyAxXSkpIHtcbiAgICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoY2ggPT09IGluUXVvdGUpIGluUXVvdGUgPSBudWxsO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICdcXFxcJykge1xuICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcoJykge1xuICAgICAgICAgIGRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJyknKSB7XG4gICAgICAgICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICAgICAgICBwYXRFbmQgPSBwO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRlcHRoLS07XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIHArKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBhdEVuZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHBhdHRlcm4gPSB0ZXh0LnNsaWNlKGksIHBhdEVuZCkudHJpbSgpO1xuICAgIGkgPSBwYXRFbmQgKyAxO1xuXG4gICAgLy8gVGhlIGJvZHk6IGV2ZXJ5dGhpbmcgdXAgdG8gdGhlIGA7O2AvYDsmYC9gOzsmYCBhdCBwYXJlbi9icmFjZSBkZXB0aCAwLlxuICAgIGxldCBib2R5RW5kID0gLTE7XG4gICAgbGV0IHRlcm0gPSAnJztcbiAgICB7XG4gICAgICBsZXQgcCA9IGk7XG4gICAgICBsZXQgZGVwdGggPSAwO1xuICAgICAgbGV0IGJkZXB0aCA9IDA7XG4gICAgICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICB3aGlsZSAocCA8IG4pIHtcbiAgICAgICAgY29uc3QgY2ggPSB0ZXh0W3BdO1xuICAgICAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtwICsgMV0pKSB7XG4gICAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNoID09PSBpblF1b3RlKSBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnXFxcXCcpIHtcbiAgICAgICAgICBwICs9IDI7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKCcpIHtcbiAgICAgICAgICBkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcpJykge1xuICAgICAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAneycpIHtcbiAgICAgICAgICBiZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnfScpIHtcbiAgICAgICAgICBiZGVwdGggPSBNYXRoLm1heCgwLCBiZGVwdGggLSAxKTtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlcHRoID09PSAwICYmIGJkZXB0aCA9PT0gMCAmJiBjaCA9PT0gJzsnKSB7XG4gICAgICAgICAgY29uc3QgbmV4dCA9IHRleHRbcCArIDFdO1xuICAgICAgICAgIGlmIChuZXh0ID09PSAnOycgfHwgbmV4dCA9PT0gJyYnKSB7XG4gICAgICAgICAgICB0ZXJtID0gbmV4dCA9PT0gJzsnID8gKHRleHRbcCArIDJdID09PSAnJicgPyAnOzsmJyA6ICc7OycpIDogJzsmJztcbiAgICAgICAgICAgIGJvZHlFbmQgPSBwO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHArKztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRlcm0gPT09ICcnKSByZXR1cm4gbnVsbDtcbiAgICBicmFuY2hlcy5wdXNoKHsgcGF0dGVybiwgYm9keTogdGV4dC5zbGljZShpLCBib2R5RW5kKS50cmltKCkgfSk7XG4gICAgaSA9IGJvZHlFbmQgKyB0ZXJtLmxlbmd0aDtcbiAgICBpZiAodGVybSA9PT0gJzsmJyB8fCB0ZXJtID09PSAnOzsmJykgZmFsbHRocm91Z2ggPSB0cnVlO1xuICB9XG59XG5cbi8qKiBSZXNvbHZlIGEgYGNhc2VgIHN1YmplY3QgYWdhaW5zdCB0aGUgcmVjb3JkZWQgYXNzaWdubWVudHMgKHBsYW4gXHUwMEE3MSwgZGVjaWRhYmxlIGNhc2UpLiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVN1YmplY3Qoc3ViamVjdDogc3RyaW5nLCBhc3NpZ25tZW50czogTWFwPHN0cmluZywgc3RyaW5nPik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtID0gc3ViamVjdC5tYXRjaCgvXlxcJChbQS1aYS16X11bQS1aYS16MC05X10qKSQvKSA/PyBzdWJqZWN0Lm1hdGNoKC9eXFwkXFx7KFtBLVphLXpfXVtBLVphLXowLTlfXSopXFx9JC8pO1xuICBpZiAobSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IHYgPSBhc3NpZ25tZW50cy5nZXQobVsxXSk7XG4gICAgcmV0dXJuIHYgIT09IHVuZGVmaW5lZCA/IHYgOiBudWxsO1xuICB9XG4gIGlmICgvWyRgXS8udGVzdChzdWJqZWN0KSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzdWJqZWN0O1xufVxuXG4vKipcbiAqIEFsdGVybmF0aXZlIHNwbGl0IG9mIGEgYGNhc2VgIHBhdHRlcm4gb24gdW5xdW90ZWQgYHxgLiBUaGUgYWx0ZXJuYXRpdmVzIGFyZVxuICogcmV0dXJuZWQgdmVyYmF0aW0gXHUyMDE0IHF1b3RlcyBhbmQgYmFja3NsYXNoIGVzY2FwZXMgcHJlc2VydmVkIFx1MjAxNCBzb1xuICogYGFuYWx5emVQYXR0ZXJuYCdzIHF1b3RlIGhhbmRsaW5nIGlzIHRoZSBzaW5nbGUgaW50ZXJwcmV0ZXI6IHN0cmlwcGluZyB0aGVtXG4gKiBoZXJlIHdvdWxkIHR1cm4gYCdhKidgIGludG8gYW4gdW5xdW90ZWQgZ2xvYiBhbmQgYFxcfGAgaW50byBhIHNwbGl0IHBvaW50LlxuICovXG5mdW5jdGlvbiBzcGxpdFBhdHRlcm5BbHRlcm5hdGl2ZXMocGF0dGVybjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1ciA9ICcnO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gcGF0dGVybltpXTtcbiAgICBpZiAoaW5RdW90ZSAhPT0gbnVsbCkge1xuICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoICYmICdcIlxcXFwkYCcuaW5jbHVkZXMocGF0dGVybltpICsgMV0pKSB7XG4gICAgICAgIGN1ciArPSBjaDtcbiAgICAgICAgY3VyICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNoID09PSBpblF1b3RlKSB7XG4gICAgICAgIGluUXVvdGUgPSBudWxsO1xuICAgICAgICBjdXIgKz0gY2g7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY3VyICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoKSB7XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjdXIgKz0gcGF0dGVybltpICsgMV07XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnfCcpIHtcbiAgICAgIHBhcnRzLnB1c2goY3VyKTtcbiAgICAgIGN1ciA9ICcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1ciArPSBjaDtcbiAgfVxuICBwYXJ0cy5wdXNoKGN1cik7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuLyoqXG4gKiBRdW90ZS1hd2FyZSBwYXR0ZXJuIGFuYWx5c2lzOiB0aGUgbGl0ZXJhbCB2YWx1ZSAocXVvdGVzIHN0cmlwcGVkLCBiYWNrc2xhc2hcbiAqIGVzY2FwZXMgcmVzb2x2ZWQpIGFuZCB3aGV0aGVyIGFueSB1bnF1b3RlZCBnbG9iIGNoYXIgYXBwZWFycy5cbiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogeyBsaXRlcmFsOiBzdHJpbmc7IGdsb2I6IGJvb2xlYW4gfSB7XG4gIGxldCBsaXRlcmFsID0gJyc7XG4gIGxldCBnbG9iID0gZmFsc2U7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXR0ZXJuLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBwYXR0ZXJuW2ldO1xuICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIGkgKyAxIDwgcGF0dGVybi5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhwYXR0ZXJuW2kgKyAxXSkpIHtcbiAgICAgICAgbGl0ZXJhbCArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkge1xuICAgICAgICBpblF1b3RlID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsaXRlcmFsICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpICsgMSA8IHBhdHRlcm4ubGVuZ3RoKSB7XG4gICAgICBsaXRlcmFsICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgnKj9bJy5pbmNsdWRlcyhjaCkpIHtcbiAgICAgIGdsb2IgPSB0cnVlO1xuICAgICAgbGl0ZXJhbCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsaXRlcmFsICs9IGNoO1xuICB9XG4gIHJldHVybiB7IGxpdGVyYWwsIGdsb2IgfTtcbn1cblxudHlwZSBQYXR0ZXJuUmVzdWx0ID0gJ21hdGNoJyB8ICduby1tYXRjaCcgfCAnZ2xvYicgfCAndW5kZWNpZGFibGUnO1xuXG4vKipcbiAqIEZpeHR1cmUtcGlubmVkIGBjYXNlYCBwYXR0ZXJuIGV2YWx1YXRpb24gKHBsYW4gXHUwMEE3MSwgZGVjaWRhYmxlIGNhc2UpOiBhIGB8YFxuICogcGF0dGVybiBpcyBkZWNpZGFibGUgaWZmIGl0cyBmaXJzdCBhbHRlcm5hdGl2ZSBpcyBhIGxpdGVyYWwgbWF0Y2ggYW5kIGV2ZXJ5XG4gKiBhbHRlcm5hdGl2ZSBhZnRlciB0aGUgZmlyc3QgaXMgYSBnbG9iIChkZWFkKTsgYSBnbG9iIGJlZm9yZSBhbnkgbGl0ZXJhbFxuICogbWF0Y2ggaXMgdW5kZWNpZGFibGUsIGFuZCBhIGxhdGVyIGxpdGVyYWwgbm9uLW1hdGNoIGFmdGVyIGEgbGl0ZXJhbCBtYXRjaFxuICogaXMgdW5kZWNpZGFibGUgKHRoZSBhbGwtbGl0ZXJhbCBgYXxiYCBmYWlsLWNsb3NlZCBkaXZlcmdlbmNlIFx1MjAxNCBiYXNoIHJ1bnNcbiAqIHRoZSBicmFuY2gpLlxuICovXG5mdW5jdGlvbiBldmFsUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcsIHN1YmplY3Q6IHN0cmluZyk6IFBhdHRlcm5SZXN1bHQge1xuICBjb25zdCBhbHRzID0gc3BsaXRQYXR0ZXJuQWx0ZXJuYXRpdmVzKHBhdHRlcm4pO1xuICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGFsdCBvZiBhbHRzKSB7XG4gICAgY29uc3QgeyBsaXRlcmFsLCBnbG9iIH0gPSBhbmFseXplUGF0dGVybihhbHQpO1xuICAgIGlmIChnbG9iKSB7XG4gICAgICBpZiAoIW1hdGNoZWQpIHJldHVybiAnZ2xvYic7XG4gICAgfSBlbHNlIGlmIChsaXRlcmFsID09PSBzdWJqZWN0KSB7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKG1hdGNoZWQpIHtcbiAgICAgIHJldHVybiAndW5kZWNpZGFibGUnO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF0Y2hlZCA/ICdtYXRjaCcgOiAnbm8tbWF0Y2gnO1xufVxuXG4vKiogVGhlIGV4ZWN1dGlvbiB3YWxrJ3Mgc2hhcmVkIHN0YXRlLCBvbmUgaW5zdGFuY2UgcGVyIGBwYXJzZUNvbW1hbmREZXRhaWxlZGAgY2FsbC4gKi9cbmNsYXNzIEV4ZWN1dGlvbldhbGtlciB7XG4gIGNoYWluOiBDaGFpblN0YXR1cyA9ICdzdWNjZXNzJztcbiAgZXJyZXhpdCA9IGZhbHNlO1xuICBwaXBlZmFpbCA9IGZhbHNlO1xuICBhc3NpZ25tZW50cyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGRlZnMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBkZWFkOiBEZWFkS2luZCB8IG51bGwgPSBudWxsO1xuICByZXR1cm5lZCA9IGZhbHNlO1xuICBmbkRlcHRoID0gMDtcbiAgbG9vcFN0YWNrOiBMb29wRnJhbWVbXSA9IFtdO1xuICByZWFkb25seSBleHBhbmRlZDogRXhwYW5kZWRTdGFnZVtdID0gW107XG4gIHJlYWRvbmx5IHZlcmRpY3RzOiBFeGVjU3RhdHVzW10gPSBbXTtcbiAgZGlyRnJhbWUgPSAwO1xuICByZWFkb25seSBkZWZQcm9iZVN0YWNrID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgd2Fsa0lucHV0KHN0YWdlczogU2ltcGxlQ29tbWFuZFtdKTogRXhwYW5kZWRTdGFnZVtdIHtcbiAgICB0aGlzLndhbGtMaXN0KHN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogZmFsc2UsIHNpZGVFZmZlY3RzOiB0cnVlLCBpbnB1dEZhY2luZzogdHJ1ZSB9KTtcbiAgICByZXR1cm4gdGhpcy5leHBhbmRlZDtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcHBlZCgpOiBib29sZWFuIHtcbiAgICBpZiAodGhpcy5kZWFkICE9PSBudWxsIHx8IHRoaXMucmV0dXJuZWQpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgIHJldHVybiB0b3AgIT09IHVuZGVmaW5lZCAmJiAodG9wLmJvZHlUZXJtaW5hdGVkIHx8IHRvcC5hbWJpZ3VvdXNTdG9wKTtcbiAgfVxuXG4gIC8qKiBXYWxrIG9uZSBsaXN0IChhIGZyZXNoIGAmJmAvYHx8YCBjaGFpbik7IHJldHVybnMgdGhlIGxpc3QncyBmaW5hbCBjaGFpbiBzdGF0dXMuICovXG4gIHByaXZhdGUgd2Fsa0xpc3Qoc3RhZ2VzOiBTaW1wbGVDb21tYW5kW10sIG9wdHM6IFdhbGtPcHRpb25zKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHNhdmVkQ2hhaW4gPSB0aGlzLmNoYWluO1xuICAgIHRoaXMuY2hhaW4gPSAnc3VjY2Vzcyc7XG4gICAgbGV0IGkgPSAwO1xuICAgIHdoaWxlIChpIDwgc3RhZ2VzLmxlbmd0aCAmJiAhdGhpcy5zdG9wcGVkKCkpIHtcbiAgICAgIGNvbnN0IGVuZCA9IHRoaXMuZ3JvdXBFbmQoc3RhZ2VzLCBpKTtcbiAgICAgIGNvbnN0IG5leHQgPSBlbmQgPCBzdGFnZXMubGVuZ3RoID8gc3RhZ2VzW2VuZF0gOiBudWxsO1xuICAgICAgdGhpcy5wcm9jZXNzR3JvdXAoc3RhZ2VzLnNsaWNlKGksIGVuZCksIG5leHQsIG9wdHMpO1xuICAgICAgaSA9IGVuZDtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5jaGFpbjtcbiAgICB3aGlsZSAoaSA8IHN0YWdlcy5sZW5ndGgpIHtcbiAgICAgIGlmIChvcHRzLmlucHV0RmFjaW5nKSB0aGlzLnZlcmRpY3RzLnB1c2goJ25vJyk7XG4gICAgICBpKys7XG4gICAgfVxuICAgIHRoaXMuY2hhaW4gPSBzYXZlZENoYWluO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIGdyb3VwRW5kKHN0YWdlczogU2ltcGxlQ29tbWFuZFtdLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgICBsZXQgZW5kID0gc3RhcnQ7XG4gICAgd2hpbGUgKGVuZCArIDEgPCBzdGFnZXMubGVuZ3RoICYmIHN0YWdlc1tlbmQgKyAxXS5wcmVjZWRlZEJ5ID09PSAncGlwZScpIGVuZCsrO1xuICAgIHJldHVybiBlbmQgKyAxO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzR3JvdXAoZ3JvdXA6IFNpbXBsZUNvbW1hbmRbXSwgbmV4dDogU2ltcGxlQ29tbWFuZCB8IG51bGwsIG9wdHM6IFdhbGtPcHRpb25zKTogdm9pZCB7XG4gICAgY29uc3QgZmlyc3QgPSBncm91cFswXTtcbiAgICBsZXQgZXhlY3V0ZXM6IGJvb2xlYW4gfCAndW5rbm93bic7XG4gICAgc3dpdGNoIChmaXJzdC5wcmVjZWRlZEJ5KSB7XG4gICAgICBjYXNlICdhbmQnOlxuICAgICAgICBleGVjdXRlcyA9IHRoaXMuY2hhaW4gPT09ICdzdWNjZXNzJyA/IHRydWUgOiB0aGlzLmNoYWluID09PSAnZmFpbHVyZScgPyBmYWxzZSA6ICd1bmtub3duJztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdvcic6XG4gICAgICAgIGV4ZWN1dGVzID0gdGhpcy5jaGFpbiA9PT0gJ2ZhaWx1cmUnID8gdHJ1ZSA6IHRoaXMuY2hhaW4gPT09ICdzdWNjZXNzJyA/IGZhbHNlIDogJ3Vua25vd24nO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGV4ZWN1dGVzID0gdHJ1ZTtcbiAgICB9XG4gICAgY29uc3QgZXhlYzogRXhlY1N0YXR1cyA9IGV4ZWN1dGVzID09PSB0cnVlID8gJ3llcycgOiBleGVjdXRlcyA9PT0gZmFsc2UgPyAnbm8nIDogJ3Vua25vd24nO1xuICAgIGNvbnN0IGJhY2tncm91bmRlZCA9IGZpcnN0LnByZWNlZGVkQnkgPT09ICdiYWNrZ3JvdW5kJyB8fCAobmV4dCAhPT0gbnVsbCAmJiBuZXh0LnByZWNlZGVkQnkgPT09ICdiYWNrZ3JvdW5kJyk7XG4gICAgaWYgKG9wdHMuaW5wdXRGYWNpbmcpIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZ3JvdXAubGVuZ3RoOyBpKyspIHRoaXMudmVyZGljdHMucHVzaChleGVjKTtcbiAgICB9XG5cbiAgICAvLyBgIWAgaXMgYSBncm91cC1sZXZlbCBtb2RpZmllcjogdGhlIGNvdW50IG9mIGxlYWRpbmcgYCFgIHdvcmRzIG9uIHRoZVxuICAgIC8vIGZpcnN0IG1lbWJlcidzIGFyZ3YgbmVnYXRlcyB0aGUgZ3JvdXAncyBmaW5hbCBzdGF0dXMgKG9kZCBuZWdhdGVzKS5cbiAgICBjb25zdCBmaXJzdEFyZ3YgPSBhcmd2T2YoZmlyc3QudGV4dCk7XG4gICAgbGV0IGJhbmdDb3VudCA9IDA7XG4gICAgbGV0IG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbCA9IGZpcnN0QXJndjtcbiAgICBpZiAoZmlyc3RBcmd2ICE9PSBudWxsKSB7XG4gICAgICB3aGlsZSAobWVtYmVyQXJndiFbYmFuZ0NvdW50XSA9PT0gJyEnKSBiYW5nQ291bnQrKztcbiAgICAgIG1lbWJlckFyZ3YgPSBtZW1iZXJBcmd2IS5zbGljZShiYW5nQ291bnQpO1xuICAgIH1cbiAgICBjb25zdCBpbnZlcnRlZCA9IGJhbmdDb3VudCAlIDIgPT09IDE7XG5cbiAgICBpZiAoZXhlYyA9PT0gJ25vJykgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3RhdHVzZXM6IENoYWluU3RhdHVzW10gPSBbXTtcbiAgICBjb25zdCBpblBpcGVsaW5lID0gZ3JvdXAubGVuZ3RoID4gMTtcbiAgICBmb3IgKGxldCBtID0gMDsgbSA8IGdyb3VwLmxlbmd0aDsgbSsrKSB7XG4gICAgICBzdGF0dXNlcy5wdXNoKFxuICAgICAgICB0aGlzLnByb2Nlc3NNZW1iZXIoZ3JvdXBbbV0sIHtcbiAgICAgICAgICBleGVjLFxuICAgICAgICAgIGluUGlwZWxpbmUsXG4gICAgICAgICAgYmFja2dyb3VuZGVkLFxuICAgICAgICAgIG1lbWJlckFyZ3Y6IG0gPT09IDAgPyBtZW1iZXJBcmd2IDogbnVsbCxcbiAgICAgICAgICBvcHRzXG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFRoZSBncm91cCBzdGF0dXM6IHRoZSBsYXN0IG1lbWJlcidzLCB1bmxlc3MgcGlwZWZhaWwgbWFrZXMgaXQgdGhlIHdvcnN0IG1lbWJlci5cbiAgICBsZXQgZ3JvdXBTdGF0dXM6IENoYWluU3RhdHVzO1xuICAgIGlmICh0aGlzLnBpcGVmYWlsICYmIGdyb3VwLmxlbmd0aCA+IDEpIHtcbiAgICAgIGlmIChzdGF0dXNlcy5ldmVyeSgocykgPT4gcyA9PT0gJ3N1Y2Nlc3MnKSkgZ3JvdXBTdGF0dXMgPSAnc3VjY2Vzcyc7XG4gICAgICBlbHNlIGlmIChzdGF0dXNlcy5zb21lKChzKSA9PiBzID09PSAnZmFpbHVyZScpKSBncm91cFN0YXR1cyA9ICdmYWlsdXJlJztcbiAgICAgIGVsc2UgZ3JvdXBTdGF0dXMgPSAndW5rbm93bic7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwU3RhdHVzID0gc3RhdHVzZXNbc3RhdHVzZXMubGVuZ3RoIC0gMV07XG4gICAgfVxuICAgIGlmIChpbnZlcnRlZCkge1xuICAgICAgZ3JvdXBTdGF0dXMgPSBncm91cFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnID8gJ2ZhaWx1cmUnIDogZ3JvdXBTdGF0dXMgPT09ICdmYWlsdXJlJyA/ICdzdWNjZXNzJyA6ICd1bmtub3duJztcbiAgICB9XG5cbiAgICAvLyBFcnJleGl0IGxpdmVuZXNzOiBhbiBleGVjdXRpbmcgZ3JvdXAgd2hvc2Ugbm9uLWV4ZW1wdCBtZW1iZXJzIGRpZCBub3RcbiAgICAvLyBhbGwgc3VjY2VlZCBraWxscyB0aGUgc2hlbGw7IGV2ZXJ5IGxhdGVyIHN0YWdlIGlzICdubycuXG4gICAgaWYgKG9wdHMubGl2ZW5lc3MgJiYgdGhpcy5lcnJleGl0ICYmIGdyb3VwU3RhdHVzICE9PSAnc3VjY2VzcycpIHtcbiAgICAgIGNvbnN0IGNoYWluRmluYWwgPSBuZXh0ID09PSBudWxsIHx8IChuZXh0LnByZWNlZGVkQnkgIT09ICdhbmQnICYmIG5leHQucHJlY2VkZWRCeSAhPT0gJ29yJyk7XG4gICAgICBpZiAoY2hhaW5GaW5hbCAmJiAhaW52ZXJ0ZWQgJiYgIWJhY2tncm91bmRlZCkgdGhpcy5kZWFkID0gJ2VycmV4aXQnO1xuICAgIH1cblxuICAgIGlmIChleGVjID09PSAneWVzJykgdGhpcy5jaGFpbiA9IGdyb3VwU3RhdHVzO1xuICAgIGVsc2UgdGhpcy5jaGFpbiA9ICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc01lbWJlcihcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IGtpbmQgPSBjbGFzc2lmeVN0YWdlKG1lbWJlci50ZXh0KTtcbiAgICBpZiAoa2luZCA9PT0gJ3BsYWluJykgcmV0dXJuIHRoaXMucHJvY2Vzc1BsYWluTWVtYmVyKG1lbWJlciwgY3R4KTtcbiAgICByZXR1cm4gdGhpcy5wcm9jZXNzQ29uc3RydWN0KG1lbWJlciwga2luZCwgY3R4KTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc1BsYWluTWVtYmVyKFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBjdHg6IHtcbiAgICAgIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gICAgICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAgICAgYmFja2dyb3VuZGVkOiBib29sZWFuO1xuICAgICAgbWVtYmVyQXJndjogc3RyaW5nW10gfCBudWxsO1xuICAgICAgb3B0czogV2Fsa09wdGlvbnM7XG4gICAgfVxuICApOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3QgeyBleGVjLCBpblBpcGVsaW5lLCBiYWNrZ3JvdW5kZWQsIG1lbWJlckFyZ3YsIG9wdHMgfSA9IGN0eDtcbiAgICBjb25zdCBhcmd2ID0gbWVtYmVyQXJndiA/PyBhcmd2T2YobWVtYmVyLnRleHQpO1xuICAgIGNvbnN0IHN0cmlwcGVkID0gYXJndiA9PT0gbnVsbCA/IG51bGwgOiB3YWxrU3RyaXAoYXJndik7XG5cbiAgICAvLyBTaWRlIGVmZmVjdHMgb25seSBmcm9tIGV4ZWN1dGVkLCBub24tcGlwZSBzdGFnZXMuXG4gICAgaWYgKGV4ZWMgPT09ICd5ZXMnICYmICFpblBpcGVsaW5lICYmIG9wdHMuc2lkZUVmZmVjdHMpIHtcbiAgICAgIHRoaXMuYXBwbHlTaWRlRWZmZWN0cyhtZW1iZXIsIGFyZ3YsIHN0cmlwcGVkKTtcbiAgICB9XG5cbiAgICAvLyBUaGUga25vd24gc3RhdHVzLlxuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMua25vd25TdGF0dXMoYXJndik7XG5cbiAgICAvLyBUaGUgdGVybWluYXRvcjogYW4gZXhlY3V0ZWQgb3IgdW5rbm93bi1leGVjdXRpb24gbm9uLXBpcGUgc3RhZ2Ugd2hvc2VcbiAgICAvLyB0ZXJtaW5hdG9yIHdvcmQgKGJhcmUsIG9yIGJlaGluZCBgY29tbWFuZGAvYGJ1aWx0aW5gKSBpcyBgZXhpdGAvYGV4ZWNgLlxuICAgIGlmICghaW5QaXBlbGluZSAmJiBleGVjICE9PSAnbm8nICYmIHN0cmlwcGVkICE9PSBudWxsICYmIChzdHJpcHBlZFswXSA9PT0gJ2V4aXQnIHx8IHN0cmlwcGVkWzBdID09PSAnZXhlYycpKSB7XG4gICAgICB0aGlzLmRlYWQgPSAnZXhpdCc7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuLXN0b3BwaW5nOiBhIHByb3ZhYmx5LWZpcmluZyBjb21tYW5kLXBvc2l0aW9uIGByZXR1cm5gIGF0XG4gICAgLy8gZnVuY3Rpb24tYm9keSBkZXB0aCBleGl0cyB0aGUgZnVuY3Rpb24gXHUyMDE0IGV2ZXJ5dGhpbmcgYWZ0ZXIgbmV2ZXIgcnVucy5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyA9PT0gJ3llcycgJiYgdGhpcy5mbkRlcHRoID4gMCAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3JldHVybicpIHtcbiAgICAgIHRoaXMucmV0dXJuZWQgPSB0cnVlO1xuICAgICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICBpZiAodG9wICE9PSB1bmRlZmluZWQpIHRvcC5vdXRjb21lID0gJ3JldHVybic7XG4gICAgfVxuXG4gICAgLy8gQnJlYWsvY29udGludWUgZXZlbnRzIChhIGhpZGRlbiBgJ3Vua25vd24nYC1leGVjIG9uZSBtYWtlcyB0aGUgZ3VhcmRcbiAgICAvLyB1bnRvdWNoYWJsZSBcdTIwMTQgYW1iaWd1b3VzIFx1MjAxNCBwZXIgdGhlIGxvb3Atc2NhbiBkaXNjaXBsaW5lKS5cbiAgICBpZiAoIWluUGlwZWxpbmUgJiYgZXhlYyAhPT0gJ25vJyAmJiBzdHJpcHBlZCAhPT0gbnVsbCAmJiAoc3RyaXBwZWRbMF0gPT09ICdicmVhaycgfHwgc3RyaXBwZWRbMF0gPT09ICdjb250aW51ZScpKSB7XG4gICAgICB0aGlzLmFwcGx5QnJlYWtDb250aW51ZShzdHJpcHBlZCwgZXhlYyk7XG4gICAgfVxuXG4gICAgLy8gQSBjYWxsIHRvIGEgcmVnaXN0ZXJlZCBkZWZpbml0aW9uLlxuICAgIGlmIChleGVjICE9PSAnbm8nICYmIHN0cmlwcGVkICE9PSBudWxsICYmIHN0cmlwcGVkLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuYXBwbHlDYWxsKHN0cmlwcGVkWzBdLCBpblBpcGVsaW5lLCBiYWNrZ3JvdW5kZWQpO1xuICAgIH1cblxuICAgIGlmICghb3B0cy5kaXNjYXJkKSB7XG4gICAgICB0aGlzLmV4cGFuZGVkLnB1c2goe1xuICAgICAgICB0ZXh0OiBtZW1iZXIudGV4dCxcbiAgICAgICAgcHJlY2VkZWRCeTogbWVtYmVyLnByZWNlZGVkQnksXG4gICAgICAgIGV4ZWMsXG4gICAgICAgIGluUGlwZWxpbmUsXG4gICAgICAgIGRpckZyYW1lOiB0aGlzLmRpckZyYW1lLFxuICAgICAgICBhc3NpZ25tZW50czogbmV3IE1hcCh0aGlzLmFzc2lnbm1lbnRzKVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5QnJlYWtDb250aW51ZShzdHJpcHBlZDogc3RyaW5nW10sIGV4ZWM6IEV4ZWNTdGF0dXMpOiB2b2lkIHtcbiAgICBjb25zdCBkZXB0aCA9IE51bWJlci5wYXJzZUludChzdHJpcHBlZFsxXSA/PyAnMScsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRlcHRoKSB8fCBkZXB0aCA8IDEpIHJldHVybjtcbiAgICBpZiAodGhpcy5sb29wU3RhY2subGVuZ3RoID09PSAwIHx8IGRlcHRoID4gdGhpcy5sb29wU3RhY2subGVuZ3RoKSByZXR1cm47XG4gICAgaWYgKGV4ZWMgPT09ICd1bmtub3duJykge1xuICAgICAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXB0aDsgZCsrKSB7XG4gICAgICAgIGNvbnN0IGZyYW1lID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMSAtIGRdO1xuICAgICAgICBpZiAoZnJhbWUub3V0Y29tZSA9PT0gJ25vbmUnKSB7XG4gICAgICAgICAgZnJhbWUub3V0Y29tZSA9ICdhbWJpZ3VvdXMnO1xuICAgICAgICAgIGZyYW1lLmFtYmlndW91c1N0b3AgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGlzQ29udGludWUgPSBzdHJpcHBlZFswXSA9PT0gJ2NvbnRpbnVlJztcbiAgICBmb3IgKGxldCBkID0gMDsgZCA8IGRlcHRoOyBkKyspIHtcbiAgICAgIGNvbnN0IGZyYW1lID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMSAtIGRdO1xuICAgICAgZnJhbWUub3V0Y29tZSA9IGlzQ29udGludWUgPyAnY29udGludWUnIDogJ2JyZWFrJztcbiAgICAgIGZyYW1lLmJvZHlUZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICAvKiogQSBtYXktcnVuIGNhbGwgdG8gYSByZWdpc3RlcmVkIGRlZmluaXRpb24gZmlyZXMgcGVyIGl0cyBib2R5J3MgZGVhZCBraW5kLiAqL1xuICBwcml2YXRlIGFwcGx5Q2FsbChuYW1lOiBzdHJpbmcsIGluUGlwZWxpbmU6IGJvb2xlYW4sIGJhY2tncm91bmRlZDogYm9vbGVhbik6IHZvaWQge1xuICAgIGlmICghdGhpcy5kZWZzLmhhcyhuYW1lKSB8fCBiYWNrZ3JvdW5kZWQpIHJldHVybjtcbiAgICBpZiAodGhpcy5kZWZQcm9iZVN0YWNrLmhhcyhuYW1lKSkgcmV0dXJuOyAvLyByZWN1cnNpb246IHRoZSBpbm5lciBjYWxsIHJldHVybnMgbm9ybWFsbHlcbiAgICBjb25zdCBib2R5ID0gdGhpcy5kZWZzLmdldChuYW1lKSE7XG4gICAgdGhpcy5kZWZQcm9iZVN0YWNrLmFkZChuYW1lKTtcbiAgICBjb25zdCBraW5kID0gdGhpcy5kZWZCb2R5RmlyZUtpbmQoYm9keSk7XG4gICAgdGhpcy5kZWZQcm9iZVN0YWNrLmRlbGV0ZShuYW1lKTtcbiAgICBpZiAoa2luZCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChraW5kID09PSAnbmV2ZXItcmV0dXJuJykge1xuICAgICAgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgfSBlbHNlIGlmICghaW5QaXBlbGluZSkge1xuICAgICAgdGhpcy5kZWFkID0ga2luZDtcbiAgICB9XG4gIH1cblxuICAvKiogV2hldGhlciBhIGRlZmluaXRpb24gYm9keSwgd2Fsa2VkIGFzIGl0cyBvd24gZnVuY3Rpb24sIGVuZHMgZGVhZC4gKi9cbiAgcHJpdmF0ZSBkZWZCb2R5RmlyZUtpbmQoYm9keTogc3RyaW5nKTogRGVhZEtpbmQgfCBudWxsIHtcbiAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGJvZHkpO1xuICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHJldHVybiAnbWFsZm9ybWVkJztcbiAgICBjb25zdCBzYXZlZERlYWQgPSB0aGlzLmRlYWQ7XG4gICAgY29uc3Qgc2F2ZWRSZXR1cm5lZCA9IHRoaXMucmV0dXJuZWQ7XG4gICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgIGNvbnN0IHNhdmVkTG9vcFN0YWNrID0gdGhpcy5sb29wU3RhY2s7XG4gICAgdGhpcy5kZWFkID0gbnVsbDtcbiAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgdGhpcy5mbkRlcHRoID0gdGhpcy5mbkRlcHRoICsgMTtcbiAgICB0aGlzLmxvb3BTdGFjayA9IFtdO1xuICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZDogdHJ1ZSwgc2lkZUVmZmVjdHM6IHRydWUsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICBjb25zdCBraW5kID0gdGhpcy5kZWFkO1xuICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICB0aGlzLnJldHVybmVkID0gc2F2ZWRSZXR1cm5lZDtcbiAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICByZXR1cm4ga2luZDtcbiAgfVxuXG4gIHByaXZhdGUga25vd25TdGF0dXMoYXJndjogc3RyaW5nW10gfCBudWxsKTogQ2hhaW5TdGF0dXMge1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIC8vIFJlZGlyZWN0cyBhbmQgdHJhbnNwYXJlbnQgd3JhcHBlcnMgYXJlIHN0cmlwcGVkIGJlZm9yZSBzdGF0dXMgZXZhbHVhdGlvblxuICAgIC8vIChwbGFuIFx1MDBBNzQvXHUwMEE3NSk6IGBlbnYgRk9PPTEgdHJ1ZWAgYW5kIGB0aW1lb3V0IDUgdHJ1ZWAgYXJlIGtub3duIHN1Y2Nlc3NlcyxcbiAgICAvLyBgdHJ1ZSA+IG91dGAga2VlcHMgaXRzIHN1Y2Nlc3MsIGFuZCBhIGZhaWwtY2xvc2VkIHdyYXBwZXIgKGBlbnYgLWkgXHUyMDI2YClcbiAgICAvLyBzdGF5cyB1bmtub3duLlxuICAgIGNvbnN0IGEgPSB3YWxrU3RyaXAoc3RyaXBXcmFwcGVycyhzdHJpcFJlZGlyZWN0cyhhcmd2KSkpO1xuICAgIGlmIChhLmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ3RydWUnIHx8IGFbMF0gPT09ICc6JykgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ2ZhbHNlJykgcmV0dXJuICdmYWlsdXJlJztcbiAgICBpZiAoYS5ldmVyeSgodykgPT4gQVNTSUdOTUVOVF9SRS50ZXN0KHcpKSkgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ2V4cG9ydCcgJiYgYS5sZW5ndGggPiAxICYmIGEuc2xpY2UoMSkuZXZlcnkoKHcpID0+IEFTU0lHTk1FTlRfUkUudGVzdCh3KSkpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgaWYgKGFbMF0gPT09ICdzZXQnKSByZXR1cm4gc2V0RmxhZ3NLbm93bihhLnNsaWNlKDEpKSA/ICdzdWNjZXNzJyA6ICd1bmtub3duJztcbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVNpZGVFZmZlY3RzKG1lbWJlcjogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10gfCBudWxsLCBzdHJpcHBlZDogc3RyaW5nW10gfCBudWxsKTogdm9pZCB7XG4gICAgaWYgKGFyZ3YgPT09IG51bGwgfHwgYXJndi5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAvLyBBc3NpZ25tZW50IHJlY29yZGluZyAobGFzdCBkZWZpbml0aW9uIHdpbnMsIGZlZWRpbmcgY2FzZSBzdWJqZWN0cykuXG4gICAgY29uc3Qgd29yZHMgPSBzcGxpdFdvcmRzKG1lbWJlci50ZXh0KTtcbiAgICBpZiAod29yZHMgIT09IG51bGwgJiYgd29yZHMubGVuZ3RoID4gMCkge1xuICAgICAgbGV0IGsgPSAwO1xuICAgICAgd2hpbGUgKGsgPCB3b3Jkcy5sZW5ndGggJiYgQVNTSUdOTUVOVF9SRS50ZXN0KHdvcmRzW2tdKSkgaysrO1xuICAgICAgaWYgKGsgPT09IHdvcmRzLmxlbmd0aCkge1xuICAgICAgICBmb3IgKGNvbnN0IHcgb2Ygd29yZHMpIHtcbiAgICAgICAgICBjb25zdCBlcSA9IHcuaW5kZXhPZignPScpO1xuICAgICAgICAgIHRoaXMuYXNzaWdubWVudHMuc2V0KHcuc2xpY2UoMCwgZXEpLCB3LnNsaWNlKGVxICsgMSkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHdvcmRzWzBdID09PSAnZXhwb3J0Jykge1xuICAgICAgICBmb3IgKGNvbnN0IHcgb2Ygd29yZHMuc2xpY2UoMSkpIHtcbiAgICAgICAgICBpZiAoQVNTSUdOTUVOVF9SRS50ZXN0KHcpKSB7XG4gICAgICAgICAgICBjb25zdCBlcSA9IHcuaW5kZXhPZignPScpO1xuICAgICAgICAgICAgdGhpcy5hc3NpZ25tZW50cy5zZXQody5zbGljZSgwLCBlcSksIHcuc2xpY2UoZXEgKyAxKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3NldCcpIHRoaXMuYXBwbHlTZXRGbGFncyhzdHJpcHBlZC5zbGljZSgxKSk7XG4gICAgLy8gVGFibGUgbGlmZWN5Y2xlIChwbGFuIFx1MDBBNzcpOiBhbiBleGVjdXRlZCBub24tcGlwZSBgdW5zZXQgTkFNRWAgZGVsZXRlcyB0aGVcbiAgICAvLyBlbnRyeSwgc28gYFg9L2E7IHVuc2V0IFg7IGNhdCAkWC9mYCBzdGF5cyB1bnJlc29sdmVkIGluc3RlYWQgb2ZcbiAgICAvLyByZXN1cnJlY3RpbmcgdGhlIHN0YWxlIHZhbHVlLiBgZXhwb3J0IE5BTUVgIHdpdGhvdXQgYSB2YWx1ZSBpcyBhIG5vLW9wXG4gICAgLy8gZm9yIHRoZSB0YWJsZSAoYmFzaCBrZWVwcyB0aGUgdmFsdWUsIGp1c3QgbWFya3MgaXQgZXhwb3J0ZWQpLlxuICAgIGlmIChzdHJpcHBlZCAhPT0gbnVsbCAmJiBzdHJpcHBlZFswXSA9PT0gJ3Vuc2V0Jykge1xuICAgICAgZm9yIChjb25zdCB3IG9mIHN0cmlwcGVkLnNsaWNlKDEpKSB7XG4gICAgICAgIGlmICghdy5zdGFydHNXaXRoKCctJykpIHRoaXMuYXNzaWdubWVudHMuZGVsZXRlKHcpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlTZXRGbGFncyhhcmdzOiBzdHJpbmdbXSk6IHZvaWQge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgICBpZiAoYSA9PT0gJy0tJykgY29udGludWU7XG4gICAgICBpZiAoIShhLnN0YXJ0c1dpdGgoJy0nKSB8fCBhLnN0YXJ0c1dpdGgoJysnKSkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgb24gPSBhLnN0YXJ0c1dpdGgoJy0nKTtcbiAgICAgIGNvbnN0IGNoYXJzID0gYS5zbGljZSgxKTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgY2hhcnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgY29uc3QgYyA9IGNoYXJzW2tdO1xuICAgICAgICBpZiAoYyA9PT0gJ28nKSB7XG4gICAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbaSArIDFdO1xuICAgICAgICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgICAgICBpZiAobmFtZSA9PT0gJ2VycmV4aXQnKSB0aGlzLmVycmV4aXQgPSBvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAnbm9lcnJleGl0JykgdGhpcy5lcnJleGl0ID0gIW9uO1xuICAgICAgICAgIGVsc2UgaWYgKG5hbWUgPT09ICdwaXBlZmFpbCcpIHRoaXMucGlwZWZhaWwgPSBvbjtcbiAgICAgICAgICBlbHNlIGlmIChuYW1lID09PSAnbm9waXBlZmFpbCcpIHRoaXMucGlwZWZhaWwgPSAhb247XG4gICAgICAgICAgaSsrO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjID09PSAnZScpIHRoaXMuZXJyZXhpdCA9IG9uO1xuICAgICAgICAvLyBFdmVyeSBvdGhlciByZWNvZ25pemVkIGxldHRlciBpcyBhIG5vLW9wIGZvciB0aGUgd2Fsay5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NDb25zdHJ1Y3QoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGtpbmQ6IENvbnN0cnVjdEtpbmQsXG4gICAgY3R4OiB7XG4gICAgICBleGVjOiBFeGVjU3RhdHVzO1xuICAgICAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgICAgIGJhY2tncm91bmRlZDogYm9vbGVhbjtcbiAgICAgIG1lbWJlckFyZ3Y6IHN0cmluZ1tdIHwgbnVsbDtcbiAgICAgIG9wdHM6IFdhbGtPcHRpb25zO1xuICAgIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHsgZXhlYywgYmFja2dyb3VuZGVkLCBvcHRzIH0gPSBjdHg7XG4gICAgY29uc3QgZGlzY2FyZCA9IG9wdHMuZGlzY2FyZCB8fCBleGVjICE9PSAneWVzJztcbiAgICBjb25zdCBzaWRlRWZmZWN0cyA9IG9wdHMuc2lkZUVmZmVjdHMgJiYgZXhlYyA9PT0gJ3llcyc7XG5cbiAgICBzd2l0Y2ggKGtpbmQpIHtcbiAgICAgIGNhc2UgJ2lmJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUlmKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVnaW9ucyA9IFtcbiAgICAgICAgICBwYXJzZWQuY29uZGl0aW9uLFxuICAgICAgICAgIHBhcnNlZC50aGVuQm9keSxcbiAgICAgICAgICAuLi5wYXJzZWQuZWxpZnMuZmxhdE1hcCgoZSkgPT4gW2UuY29uZGl0aW9uLCBlLmJvZHldKSxcbiAgICAgICAgICAuLi4ocGFyc2VkLmVsc2VCb2R5ICE9PSBudWxsID8gW3BhcnNlZC5lbHNlQm9keV0gOiBbXSlcbiAgICAgICAgXTtcbiAgICAgICAgY29uc3QgY29uZFN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChwYXJzZWQuY29uZGl0aW9uKS5zdGFnZXMsIHtcbiAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICBzaWRlRWZmZWN0czogdHJ1ZSxcbiAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChjb25kU3RhdHVzID09PSAndW5rbm93bicpIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgaWYgKGNvbmRTdGF0dXMgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLnRoZW5Cb2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBlbGlmIG9mIHBhcnNlZC5lbGlmcykge1xuICAgICAgICAgIGNvbnN0IGVTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwoZWxpZi5jb25kaXRpb24pLnN0YWdlcywge1xuICAgICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgICAgZGlzY2FyZDogdHJ1ZSxcbiAgICAgICAgICAgIHNpZGVFZmZlY3RzOiB0cnVlLFxuICAgICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKGVTdGF0dXMgPT09ICd1bmtub3duJykgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICAgIGlmIChlU3RhdHVzID09PSAnc3VjY2VzcycpIHJldHVybiB0aGlzLndhbGtCcmFuY2goZWxpZi5ib2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnNlZC5lbHNlQm9keSAhPT0gbnVsbCkgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQuZWxzZUJvZHksIGRpc2NhcmQsIHNpZGVFZmZlY3RzKTtcbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3doaWxlJzpcbiAgICAgIGNhc2UgJ3VudGlsJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUxvb3AobWVtYmVyLnRleHQsIGtpbmQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCBjb25kU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKHBhcnNlZC5jb25kaXRpb24pLnN0YWdlcywge1xuICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICBkaXNjYXJkOiB0cnVlLFxuICAgICAgICAgIHNpZGVFZmZlY3RzOiB0cnVlLFxuICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGNvbmRTdGF0dXMgPT09ICd1bmtub3duJykgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChbcGFyc2VkLmNvbmRpdGlvbiwgcGFyc2VkLmJvZHldLCBjdHgpO1xuICAgICAgICBjb25zdCBib2R5UnVucyA9IGtpbmQgPT09ICd3aGlsZScgPyBjb25kU3RhdHVzID09PSAnc3VjY2VzcycgOiBjb25kU3RhdHVzID09PSAnZmFpbHVyZSc7XG4gICAgICAgIGlmICghYm9keVJ1bnMpIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocGFyc2VkLmJvZHkpO1xuICAgICAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBmcmFtZTogTG9vcEZyYW1lID0geyBvdXRjb21lOiAnbm9uZScsIGJvZHlUZXJtaW5hdGVkOiBmYWxzZSwgYW1iaWd1b3VzU3RvcDogZmFsc2UgfTtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sucHVzaChmcmFtZSk7XG4gICAgICAgIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sucG9wKCk7XG4gICAgICAgIHN3aXRjaCAoZnJhbWUub3V0Y29tZSkge1xuICAgICAgICAgIGNhc2UgJ2JyZWFrJzpcbiAgICAgICAgICAgIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgICAgICAgY2FzZSAnY29udGludWUnOlxuICAgICAgICAgIGNhc2UgJ25vbmUnOlxuICAgICAgICAgICAgaWYgKHRoaXMuZGVhZCA9PT0gbnVsbCAmJiAhYmFja2dyb3VuZGVkKSB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgICAgY2FzZSAnYW1iaWd1b3VzJzpcbiAgICAgICAgICBjYXNlICdyZXR1cm4nOlxuICAgICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgfVxuICAgICAgY2FzZSAnZm9yJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUZvcihtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGlmIChwYXJzZWQubGlzdCA9PT0gbnVsbCB8fCBwYXJzZWQubGlzdC5zb21lKCh3KSA9PiAvWyRgXS8udGVzdCh3KSkpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKFtwYXJzZWQud2hvbGVJbnRlcmlvcl0sIGN0eCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBhcnNlZC5saXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChwYXJzZWQuYm9keSk7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICB9XG4gICAgICBjYXNlICdjYXNlJzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUNhc2UobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCByZWdpb25zID0gcGFyc2VkLmJyYW5jaGVzLm1hcCgoYikgPT4gYi5ib2R5KTtcbiAgICAgICAgaWYgKHBhcnNlZC5mYWxsdGhyb3VnaCB8fCByZXNvbHZlU3ViamVjdChwYXJzZWQuc3ViamVjdCwgdGhpcy5hc3NpZ25tZW50cykgPT09IG51bGwpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc3ViamVjdCA9IHJlc29sdmVTdWJqZWN0KHBhcnNlZC5zdWJqZWN0LCB0aGlzLmFzc2lnbm1lbnRzKSE7XG4gICAgICAgIGxldCBtYXRjaGVkQnJhbmNoID0gLTE7XG4gICAgICAgIGxldCB1bmRlY2lkYWJsZSA9IGZhbHNlO1xuICAgICAgICBmb3IgKGxldCBiID0gMDsgYiA8IHBhcnNlZC5icmFuY2hlcy5sZW5ndGg7IGIrKykge1xuICAgICAgICAgIGNvbnN0IHIgPSBldmFsUGF0dGVybihwYXJzZWQuYnJhbmNoZXNbYl0ucGF0dGVybiwgc3ViamVjdCk7XG4gICAgICAgICAgaWYgKHIgPT09ICdtYXRjaCcpIHtcbiAgICAgICAgICAgIG1hdGNoZWRCcmFuY2ggPSBiO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyID09PSAnZ2xvYicgfHwgciA9PT0gJ3VuZGVjaWRhYmxlJykge1xuICAgICAgICAgICAgdW5kZWNpZGFibGUgPSB0cnVlO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICh1bmRlY2lkYWJsZSkgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICBpZiAobWF0Y2hlZEJyYW5jaCAhPT0gLTEpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC5icmFuY2hlc1ttYXRjaGVkQnJhbmNoXS5ib2R5LCBkaXNjYXJkLCBzaWRlRWZmZWN0cyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3NlbGVjdCc6IHtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VMb29wKG1lbWJlci50ZXh0LCAnd2hpbGUnKTtcbiAgICAgICAgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChwYXJzZWQgIT09IG51bGwgPyBbcGFyc2VkLmJvZHldIDogW10sIGN0eCk7XG4gICAgICB9XG4gICAgICBjYXNlICdicmFjZSc6IHtcbiAgICAgICAgY29uc3QgaW50ZXJpb3IgPSBleHRyYWN0R3JvdXBCb2R5KG1lbWJlci50ZXh0LCAneycsICd9Jyk7XG4gICAgICAgIGlmIChpbnRlcmlvciA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChpbnRlcmlvcik7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICB9XG4gICAgICBjYXNlICdzdWJzaGVsbCc6IHtcbiAgICAgICAgY29uc3QgaW50ZXJpb3IgPSBleHRyYWN0R3JvdXBCb2R5KG1lbWJlci50ZXh0LCAnKCcsICcpJyk7XG4gICAgICAgIGlmIChpbnRlcmlvciA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChpbnRlcmlvcik7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNhdmVkRXJyZXhpdCA9IHRoaXMuZXJyZXhpdDtcbiAgICAgICAgY29uc3Qgc2F2ZWRQaXBlZmFpbCA9IHRoaXMucGlwZWZhaWw7XG4gICAgICAgIGNvbnN0IHNhdmVkQXNzaWdubWVudHMgPSB0aGlzLmFzc2lnbm1lbnRzO1xuICAgICAgICBjb25zdCBzYXZlZERlZnMgPSB0aGlzLmRlZnM7XG4gICAgICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgICAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgICAgIGNvbnN0IHNhdmVkTG9vcFN0YWNrID0gdGhpcy5sb29wU3RhY2s7XG4gICAgICAgIGNvbnN0IHNhdmVkRGlyRnJhbWUgPSB0aGlzLmRpckZyYW1lO1xuICAgICAgICBjb25zdCBzYXZlZERlYWQgPSB0aGlzLmRlYWQ7XG4gICAgICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICAgICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgICAgIHRoaXMuYXNzaWdubWVudHMgPSBuZXcgTWFwKHNhdmVkQXNzaWdubWVudHMpO1xuICAgICAgICB0aGlzLmRlZnMgPSBuZXcgTWFwKHNhdmVkRGVmcyk7XG4gICAgICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5mbkRlcHRoID0gMDtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sgPSBbXTtcbiAgICAgICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWUgKyAxO1xuICAgICAgICB0aGlzLmRlYWQgPSBudWxsO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gICAgICAgIGNvbnN0IGlubmVyRGVhZCA9IHRoaXMuZGVhZDtcbiAgICAgICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgICAgICB0aGlzLnBpcGVmYWlsID0gc2F2ZWRQaXBlZmFpbDtcbiAgICAgICAgdGhpcy5hc3NpZ25tZW50cyA9IHNhdmVkQXNzaWdubWVudHM7XG4gICAgICAgIHRoaXMuZGVmcyA9IHNhdmVkRGVmcztcbiAgICAgICAgdGhpcy5yZXR1cm5lZCA9IHNhdmVkUmV0dXJuZWQ7XG4gICAgICAgIHRoaXMuZm5EZXB0aCA9IHNhdmVkRm5EZXB0aDtcbiAgICAgICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICAgICAgdGhpcy5kaXJGcmFtZSA9IHNhdmVkRGlyRnJhbWU7XG4gICAgICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICAgICAgLy8gQSBzdWJzaGVsbCBpcyBhIHByb2Nlc3MgYm91bmRhcnkgZm9yIHRoZSBleGl0IGZpcmUgYnV0IG5vdCBmb3IgdGhlXG4gICAgICAgIC8vIG5ldmVyLXJldHVybiBmaXJlOiB0aGUgc2hlbGwgc3luY2hyb25vdXNseSB3YWl0cyBmb3IgdGhlIHN1YnNoZWxsLlxuICAgICAgICBpZiAoaW5uZXJEZWFkID09PSAnbmV2ZXItcmV0dXJuJykgdGhpcy5kZWFkID0gJ25ldmVyLXJldHVybic7XG4gICAgICAgIHJldHVybiBzdGF0dXM7XG4gICAgICB9XG4gICAgICBjYXNlICdkZWYnOiB7XG4gICAgICAgIC8vIFRoZSBkZWZpbml0aW9uIHJlZ2lzdGVycyB3aXRoIHRoZSB3YWxrIHNjb3BlIHdoZW4gZXhlY3V0ZWQuXG4gICAgICAgIGlmIChzaWRlRWZmZWN0cykge1xuICAgICAgICAgIGNvbnN0IGRlZiA9IHBhcnNlRGVmKG1lbWJlci50ZXh0KTtcbiAgICAgICAgICBpZiAoZGVmICE9PSBudWxsKSB0aGlzLmRlZnMuc2V0KGRlZi5uYW1lLCBkZWYuYm9keSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgd2Fsa0JyYW5jaChib2R5OiBzdHJpbmcsIGRpc2NhcmQ6IGJvb2xlYW4sIHNpZGVFZmZlY3RzOiBib29sZWFuKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoYm9keSk7XG4gICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5kZWFkID0gJ21hbGZvcm1lZCc7XG4gICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBvcGFxdWUtY29uc3RydWN0IHRyZWF0bWVudCAocGxhbiBcdTAwQTcyKTogcmUtc3BsaXQgZWFjaCByZWdpb24gYW5kIHdhbGsgaXRcbiAgICogd2l0aCB0aGUgc2FtZSBtYWNoaW5lcnkgc28gYW4gYGV4aXRgL2BleGVjYCB0aGF0IG1heSBoYXZlIHJ1biwgb3IgYVxuICAgKiBuZXZlci1leGl0IGxvb3AsIGZpcmVzIGZhaWwtY2xvc2VkOyBoaWRkZW4gYnJlYWsvY29udGludWUgd29yZHMgcmVhY2ggdGhlXG4gICAqIHNjYW5uZWQgbG9vcCBhcyBhbiBhbWJpZ3VvdXMgdGVybWluYXRpb24uIFN0YXRlIGlzIHNuYXBzaG90LXJlc3RvcmVkLlxuICAgKi9cbiAgcHJpdmF0ZSBvcGFxdWVQYXRoKFxuICAgIHJlZ2lvbnM6IHN0cmluZ1tdLFxuICAgIGN0eDogeyBleGVjOiBFeGVjU3RhdHVzOyBpblBpcGVsaW5lOiBib29sZWFuOyBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47IG9wdHM6IFdhbGtPcHRpb25zIH1cbiAgKTogQ2hhaW5TdGF0dXMge1xuICAgIGNvbnN0IGZpbmRpbmdzID0gdGhpcy5zY2FuT3BhcXVlKHJlZ2lvbnMpO1xuICAgIGlmIChmaW5kaW5ncy5maXJlICE9PSBudWxsKSB7XG4gICAgICBpZiAoZmluZGluZ3MuZmlyZSA9PT0gJ25ldmVyLXJldHVybicpIHtcbiAgICAgICAgaWYgKCFjdHguYmFja2dyb3VuZGVkKSB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICAgIH0gZWxzZSBpZiAoIWN0eC5pblBpcGVsaW5lICYmICFjdHguYmFja2dyb3VuZGVkKSB7XG4gICAgICAgIHRoaXMuZGVhZCA9IGZpbmRpbmdzLmZpcmU7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChmaW5kaW5ncy5icmVha1RhcmdldCAhPT0gJ25vbmUnKSB7XG4gICAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICAgIGlmICh0b3AgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0b3Aub3V0Y29tZSA9ICdhbWJpZ3VvdXMnO1xuICAgICAgICB0b3AuYW1iaWd1b3VzU3RvcCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIHNjYW5PcGFxdWUocmVnaW9uczogc3RyaW5nW10pOiB7IGZpcmU6IERlYWRLaW5kIHwgbnVsbDsgYnJlYWtUYXJnZXQ6ICdicmVhaycgfCAnY29udGludWUnIHwgJ25vbmUnIH0ge1xuICAgIGNvbnN0IHJlcG9ydDogeyBmaXJlOiBEZWFkS2luZCB8IG51bGw7IGJyZWFrVGFyZ2V0OiAnYnJlYWsnIHwgJ2NvbnRpbnVlJyB8ICdub25lJyB9ID0ge1xuICAgICAgZmlyZTogbnVsbCxcbiAgICAgIGJyZWFrVGFyZ2V0OiAnbm9uZSdcbiAgICB9O1xuICAgIGNvbnN0IHNhdmVkQ2hhaW4gPSB0aGlzLmNoYWluO1xuICAgIGNvbnN0IHNhdmVkRXJyZXhpdCA9IHRoaXMuZXJyZXhpdDtcbiAgICBjb25zdCBzYXZlZFBpcGVmYWlsID0gdGhpcy5waXBlZmFpbDtcbiAgICBjb25zdCBzYXZlZEFzc2lnbm1lbnRzID0gdGhpcy5hc3NpZ25tZW50cztcbiAgICBjb25zdCBzYXZlZERlZnMgPSB0aGlzLmRlZnM7XG4gICAgY29uc3Qgc2F2ZWREZWFkID0gdGhpcy5kZWFkO1xuICAgIGNvbnN0IHNhdmVkUmV0dXJuZWQgPSB0aGlzLnJldHVybmVkO1xuICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICBjb25zdCBzYXZlZExvb3BTdGFjayA9IHRoaXMubG9vcFN0YWNrO1xuICAgIGNvbnN0IHNhdmVkRGlyRnJhbWUgPSB0aGlzLmRpckZyYW1lO1xuICAgIGNvbnN0IHNhdmVkVmVyZGljdHMgPSB0aGlzLnZlcmRpY3RzLmxlbmd0aDtcbiAgICBjb25zdCBzYXZlZEV4cGFuZGVkID0gdGhpcy5leHBhbmRlZC5sZW5ndGg7XG4gICAgY29uc3Qgc2F2ZWREZWZQcm9iZSA9IG5ldyBTZXQodGhpcy5kZWZQcm9iZVN0YWNrKTtcblxuICAgIGZvciAoY29uc3QgcmVnaW9uIG9mIHJlZ2lvbnMpIHtcbiAgICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwocmVnaW9uKTtcbiAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmVwb3J0LmZpcmUgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0aGlzLmRlYWQgPSBudWxsO1xuICAgICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgICAgLy8gRWFjaCByZWdpb24gd2Fsa3MgYWdhaW5zdCBhIGZyZXNoIGNvcHkgb2YgdGhlIGVuY2xvc2luZyBsb29wIGZyYW1lcyBzb1xuICAgICAgLy8gaXRzIGhpZGRlbiBicmVhay9jb250aW51ZSBldmVudHMgYXJlIHJlcG9ydGVkLCBuZXZlciBhcHBsaWVkLlxuICAgICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjay5tYXAoKGYpID0+ICh7IC4uLmYgfSkpO1xuICAgICAgdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkOiB0cnVlLCBzaWRlRWZmZWN0czogZmFsc2UsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgIGlmICh0aGlzLmRlYWQgIT09IG51bGwpIHtcbiAgICAgICAgaWYgKHJlcG9ydC5maXJlID09PSBudWxsIHx8IHRoaXMuZGVhZCA9PT0gJ25ldmVyLXJldHVybicgfHwgdGhpcy5kZWFkID09PSAnbWFsZm9ybWVkJykgcmVwb3J0LmZpcmUgPSB0aGlzLmRlYWQ7XG4gICAgICB9XG4gICAgICBpZiAocmVwb3J0LmJyZWFrVGFyZ2V0ID09PSAnbm9uZScpIHtcbiAgICAgICAgY29uc3QgaW5uZXJtb3N0ID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgICAgIGlmIChpbm5lcm1vc3QgIT09IHVuZGVmaW5lZCAmJiAoaW5uZXJtb3N0Lm91dGNvbWUgPT09ICdicmVhaycgfHwgaW5uZXJtb3N0Lm91dGNvbWUgPT09ICdjb250aW51ZScpKSB7XG4gICAgICAgICAgcmVwb3J0LmJyZWFrVGFyZ2V0ID0gaW5uZXJtb3N0Lm91dGNvbWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNoYWluID0gc2F2ZWRDaGFpbjtcbiAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgdGhpcy5waXBlZmFpbCA9IHNhdmVkUGlwZWZhaWw7XG4gICAgdGhpcy5hc3NpZ25tZW50cyA9IHNhdmVkQXNzaWdubWVudHM7XG4gICAgdGhpcy5kZWZzID0gc2F2ZWREZWZzO1xuICAgIHRoaXMuZGVhZCA9IHNhdmVkRGVhZDtcbiAgICB0aGlzLnJldHVybmVkID0gc2F2ZWRSZXR1cm5lZDtcbiAgICB0aGlzLmZuRGVwdGggPSBzYXZlZEZuRGVwdGg7XG4gICAgdGhpcy5sb29wU3RhY2sgPSBzYXZlZExvb3BTdGFjaztcbiAgICB0aGlzLmRpckZyYW1lID0gc2F2ZWREaXJGcmFtZTtcbiAgICB0aGlzLnZlcmRpY3RzLmxlbmd0aCA9IHNhdmVkVmVyZGljdHM7XG4gICAgdGhpcy5leHBhbmRlZC5sZW5ndGggPSBzYXZlZEV4cGFuZGVkO1xuICAgIHRoaXMuZGVmUHJvYmVTdGFjay5jbGVhcigpO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBzYXZlZERlZlByb2JlKSB0aGlzLmRlZlByb2JlU3RhY2suYWRkKG5hbWUpO1xuICAgIHJldHVybiByZXBvcnQ7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKlxuICogUGFyc2UgYGhlYWRgL2B0YWlsYCBmbGFncyBhbmQgZmlsZSBhcmdzLiBBIGJhcmUgYCtOYCBpcyBhIGZyb20tTiBjb3VudCBvbmx5XG4gKiBmb3IgYHRhaWxgIChgdGFpbCArNSBmYCBzdGFydHMgYXQgbGluZSA1KTsgR05VIGBoZWFkYCB0cmVhdHMgYmFyZSBgK05gIGFzIGFcbiAqICpmaWxlKiAoY29yZXV0aWxzIDkuNyBcdTIwMTQgcHJvYmU6IGBoZWFkICs1IGZgIGVycm9ycyBcImNhbm5vdCBvcGVuICcrNSdcIiBhbmRcbiAqIHJlYWRzIGYncyBmaXJzdCAxMCBsaW5lcyksIHNvIGBiYXJlUGx1c0lzQ291bnRgIGlzIGZhbHNlIGZvciBoZWFkIGFuZCB0aGVcbiAqIHdvcmQgZmFsbHMgdGhyb3VnaCB0byB0aGUgZmlsZSBsaXN0LlxuICovXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MoXG4gIHJlc3Q6IHN0cmluZ1tdLFxuICBiYXJlUGx1c0lzQ291bnQ6IGJvb2xlYW5cbik6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgaWYgKGJhcmVQbHVzSXNDb3VudCkge1xuICAgICAgICBmcm9tU3RhcnQgPSB0cnVlO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1cXGQrJC8udGVzdChhKSkge1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBmaWxlcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hIZWFkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnaGVhZCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIGZhbHNlKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICAvLyBCYXJlIGArTmAgaXMgYSBHTlUtaGVhZCBmaWxlIGFydGlmYWN0LCBuZXZlciBhIHJlYWwgcmVhZCBcdTIwMTQgZHJvcCBpdC5cbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScgJiYgIS9eXFwrXFxkKyQvLnRlc3QoZikpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSksIHRydWUpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKHBsYW4gXHUwMEE3NS4yKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dCBwYXNzIGJlY2F1c2UgdGhlXG4vLyBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgY29uZnVzZVxuLy8gc3BsaXRUb3BMZXZlbC4gVGhlIG9wZW5lciBzY2FubmVyIGlzIHF1b3RlLWF3YXJlIGFuZCB2YWxpZGF0ZXMgdGhlIGNsb3Npbmdcbi8vIGRlbGltaXRlcjsgbWF0Y2hlZCBoZXJlZG9jcyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nIChyZXBsYWNlZCB3aXRoIGFuXG4vLyBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2YgdGhlIHBpcGVsaW5lIHJ1bnMsXG4vLyBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGUgd3JpdGUgaXMgcmVzb2x2ZWRcbi8vIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGhlcmVkb2MncyBjb250ZW50LWNhcnJ5aW5nIGZhY3RzLCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgd2Fsay4gKi9cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICAvKiogVGhlIG9wZW5lciBsaW5lIHZlcmJhdGltIChlLmcuIGBjYXQgPiBmIDw8J0VPRidgKSwgcmUtdG9rZW5pemVkIGR1cmluZyB0aGUgd2Fsay4gKi9cbiAgb3BlbmVyOiBzdHJpbmc7XG4gIC8qKiBUaGUgaGVyZWRvYyBib2R5OyBgPDwtYCBib2RpZXMgaGF2ZSBsZWFkaW5nIHRhYnMgc3RyaXBwZWQgcGVyIGxpbmUuICovXG4gIGJvZHk6IHN0cmluZztcbiAgLyoqIFdoZXRoZXIgdGhlIGRlbGltaXRlciB3YXMgcXVvdGVkL2VzY2FwZWQgKGA8PCdFT0YnYCwgYDw8XCJFT0ZcImAsIGA8PFxcRU9GYCk6IHRoZSBib2R5IHRoZW4gdW5kZXJnb2VzIG5vIHNoZWxsIGV4cGFuc2lvbi4gKi9cbiAgcXVvdGVkRGVsaW06IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBIZXJlZG9jT3BlbmVyIHtcbiAgLyoqIFdoZXJlIHRoZSBoZXJlZG9jJ3Mgc2ltcGxlIGNvbW1hbmQgc3RhcnRzIGluIHRoZSByYXcgc3RyaW5nLiAqL1xuICBjbWRTdGFydDogbnVtYmVyO1xuICAvKiogVGhlIG5ld2xpbmUgZW5kaW5nIHRoZSBvcGVuZXIgbGluZSwgb3IgcmF3Lmxlbmd0aCB3aGVuIGl0J3MgdGhlIGxhc3QgbGluZS4gKi9cbiAgb3BlbmVyTGluZUVuZDogbnVtYmVyO1xuICAvKiogVGhlIGNsb3NpbmcgZGVsaW1pdGVyIChxdW90ZXMgc3RyaXBwZWQpLiAqL1xuICBkZWxpbTogc3RyaW5nO1xuICAvKiogYDw8LWA6IHN0cmlwIGxlYWRpbmcgdGFicyBmcm9tIHRoZSBib2R5IGFuZCB0aGUgY2xvc2VyIGxpbmUuICovXG4gIHRhYlN0cmlwOiBib29sZWFuO1xuICAvKiogV2hldGhlciB0aGUgZGVsaW1pdGVyIHdhcyBxdW90ZWQvZXNjYXBlZCBcdTIwMTQgdGhlIHNoZWxsIHNraXBzIGJvZHkgZXhwYW5zaW9uIHRoZW4uICovXG4gIHF1b3RlZERlbGltOiBib29sZWFuO1xufVxuXG5jb25zdCBCQVJFX0RFTElNID0gL15bQS1aYS16X11bQS1aYS16MC05X10qJC87XG5cbi8qKlxuICogRmluZCB0aGUgbmV4dCBoZXJlZG9jIG9wZW5lciAoYDw8YC9gPDwtYCkgYXQgdG9wIGxldmVsLCBzY2FubmluZyBmcm9tXG4gKiBgZnJvbWAuIE1pcnJvcnMgc3BsaXRUb3BMZXZlbCdzIHNlcGFyYXRvciBoYW5kbGluZyBzbyBgY21kU3RhcnRgIG1hcmtzIHRoZVxuICogb3BlbmVyJ3Mgb3duIHNpbXBsZSBjb21tYW5kOiB0b3AtbGV2ZWwgYCYmYC9gfHxgL2A7YC9uZXdsaW5lL2AmYCBzdGFydCBhIG5ld1xuICogY29tbWFuZCAoYSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uKSwgYD5gLXJlZGlyZWN0cywgZHVwXG4gKiByZWRpcmVjdHMgKGAyPiYxYCkgYW5kIHBhcmVuIG5lc3Rpbmcgc3RheSBpbnNpZGUgdGhlIGNvbW1hbmQsIGFuZFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCkgYXJlIG91dCBvZiBzY29wZS4gQW4gSU9fTlVNQkVSIGZkIGRpcmVjdGx5IGJlZm9yZSB0aGVcbiAqIG9wZXJhdG9yIChgMjw8RU9GYCkgcmVkaXJlY3RzIHRoYXQgZmQsIG5vdCBzdGRpbiBcdTIwMTQgbm90IGEgaGVyZWRvYy4gUmV0dXJuc1xuICogbnVsbCB3aGVuIG5vIG9wZW5lciBpcyBmb3VuZC5cbiAqL1xuZnVuY3Rpb24gZmluZEhlcmVkb2NPcGVuZXIocmF3OiBzdHJpbmcsIGZyb206IG51bWJlcik6IEhlcmVkb2NPcGVuZXIgfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGNtZFN0YXJ0ID0gZnJvbTtcbiAgbGV0IHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gIGxldCBpID0gZnJvbTtcblxuICAvKiogUmVhZCBvbmUgZGVsaW1pdGVyIHdvcmQgc3RhcnRpbmcgYXQgYHN0YXJ0YCAodGhlIGF0dGFjaGVkIHRhaWwgb2YgYDw8RU9GYC9gPDwnRU9GJ2AsIG9yIGEgc3RhbmRhbG9uZSBuZXh0IHdvcmQpLiBRdW90ZXMgY29udHJpYnV0ZSB0aGVpciBjb250ZW50OyBhIGJhY2tzbGFzaCBlc2NhcGVzIHRoZSBuZXh0IGNoYXIuIFJldHVybnMgbnVsbCBvbiBhbiB1bmJhbGFuY2VkIHF1b3RlIChmYWlsIGNsb3NlZCkuICovXG4gIGNvbnN0IHJlYWREZWxpbVdvcmQgPSAoc3RhcnQ6IG51bWJlcik6IHsgZGVsaW06IHN0cmluZzsgc2F3UXVvdGU6IGJvb2xlYW47IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGQgPSAnJztcbiAgICBsZXQgc2F3UXVvdGUgPSBmYWxzZTtcbiAgICBsZXQgayA9IHN0YXJ0O1xuICAgIHdoaWxlIChrIDwgbiAmJiAhL1xccy8udGVzdChyYXdba10pICYmIHJhd1trXSAhPT0gJzwnICYmIHJhd1trXSAhPT0gJz4nKSB7XG4gICAgICBjb25zdCBjID0gcmF3W2tdO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgICBsZXQgbSA9IGsgKyAxO1xuICAgICAgICB3aGlsZSAobSA8IG4gJiYgcmF3W21dICE9PSBxdW90ZSkge1xuICAgICAgICAgIGQgKz0gcmF3W21dO1xuICAgICAgICAgIG0gKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrID0gbSArIDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBrICsgMSA8IG4pIHtcbiAgICAgICAgLy8gQSBiYWNrc2xhc2gtZXNjYXBlZCBkZWxpbWl0ZXIgY2hhciBxdW90ZXMgdGhlIGRlbGltaXRlciBcdTIwMTQgdGhlIGJvZHlcbiAgICAgICAgLy8gaXMgbGl0ZXJhbCAoYDw8XFxFT0ZgKSwgc2FtZSBhcyBxdW90ZXMuXG4gICAgICAgIGQgKz0gcmF3W2sgKyAxXTtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZCArPSBjO1xuICAgICAgayArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBkZWxpbTogZCwgc2F3UXVvdGUsIG5leHQ6IGsgfTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gcmF3W2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPiAwKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCcmJicsIGkpIHx8IHJhdy5zdGFydHNXaXRoKCd8fCcsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAyO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJ3wmJywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgIC8vIEEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiAobWlycm9yaW5nXG4gICAgICAvLyBzcGxpdFRvcExldmVsKTsgYW55dGhpbmcgZWxzZSBzdGFydHMgYSBuZXcgc2ltcGxlIGNvbW1hbmQuXG4gICAgICBpZiAoIXBlbmRpbmdQaXBlKSBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgYW5kIGR1cCByZWRpcmVjdHMgKGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90XG4gICAgICAvLyBjb21tYW5kIHNlcGFyYXRvcnMgKG1pcnJvcmluZyBzcGxpdFRvcExldmVsKS5cbiAgICAgIGNvbnN0IHRyaW1tZWQgPSByYXcuc2xpY2UoY21kU3RhcnQsIGkpLnRyaW1FbmQoKTtcbiAgICAgIGNvbnN0IGR1cFJlZGlyZWN0ID1cbiAgICAgICAgdHJpbW1lZC5lbmRzV2l0aCgnPicpICYmICh0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdCh0cmltbWVkW3RyaW1tZWQubGVuZ3RoIC0gMl0gPz8gJycpKTtcbiAgICAgIGlmIChyYXdbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgJiYgcmF3W2kgKyAxXSA9PT0gJzwnKSB7XG4gICAgICAvLyBgPDw8YCBpcyBhIGhlcmUtc3RyaW5nIChvdXQgb2Ygc2NvcGUpOyBgPDwtYCBzdHJpcHMgbGVhZGluZyB0YWJzLlxuICAgICAgaWYgKHJhd1tpICsgMl0gPT09ICc8Jykge1xuICAgICAgICBpICs9IDM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGV0IGogPSBpIC0gMTtcbiAgICAgIHdoaWxlIChqID49IGZyb20gJiYgL1xcZC8udGVzdChyYXdbal0pKSBqIC09IDE7XG4gICAgICBjb25zdCBpb051bWJlciA9IGogPCBpIC0gMSAmJiAoaiA8IGZyb20gfHwgL1xcc3xbO3wmKF0vLnRlc3QocmF3W2pdKSk7XG4gICAgICBpZiAoaW9OdW1iZXIpIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRhYlN0cmlwID0gcmF3W2kgKyAyXSA9PT0gJy0nO1xuICAgICAgY29uc3Qgb3BMZW4gPSB0YWJTdHJpcCA/IDMgOiAyO1xuICAgICAgY29uc3QgbGluZUVuZCA9IHJhdy5pbmRleE9mKCdcXG4nLCBpKTtcbiAgICAgIGNvbnN0IG9wZW5lckxpbmVFbmQgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kO1xuICAgICAgY29uc3QgYXR0YWNoZWQgPSByZWFkRGVsaW1Xb3JkKGkgKyBvcExlbik7XG4gICAgICBsZXQgZGVsaW0gPSBhdHRhY2hlZCA9PT0gbnVsbCA/ICcnIDogYXR0YWNoZWQuZGVsaW07XG4gICAgICBsZXQgc2F3UXVvdGUgPSBhdHRhY2hlZCA9PT0gbnVsbCA/IGZhbHNlIDogYXR0YWNoZWQuc2F3UXVvdGU7XG4gICAgICBpZiAoZGVsaW0gPT09ICcnICYmIGF0dGFjaGVkICE9PSBudWxsKSB7XG4gICAgICAgIC8vIFN0YW5kYWxvbmUgb3BlcmF0b3I6IHRoZSBkZWxpbWl0ZXIgaXMgdGhlIG5leHQgd29yZC5cbiAgICAgICAgbGV0IGsgPSBhdHRhY2hlZC5uZXh0O1xuICAgICAgICB3aGlsZSAoayA8IG9wZW5lckxpbmVFbmQgJiYgL1xccy8udGVzdChyYXdba10pKSBrICs9IDE7XG4gICAgICAgIGNvbnN0IHdvcmQgPSByZWFkRGVsaW1Xb3JkKGspO1xuICAgICAgICBpZiAod29yZCA9PT0gbnVsbCkgZGVsaW0gPSAnJztcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgZGVsaW0gPSB3b3JkLmRlbGltO1xuICAgICAgICAgIHNhd1F1b3RlID0gd29yZC5zYXdRdW90ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGRlbGltID09PSAnJyB8fCAoIXNhd1F1b3RlICYmICFCQVJFX0RFTElNLnRlc3QoZGVsaW0pKSkge1xuICAgICAgICAvLyBObyBkZWxpbWl0ZXIsIG9yIGEgYmFyZSBmb3JtIG91dHNpZGUgdGhlIGlkZW50aWZpZXIgc2hhcGUgXHUyMDE0IGZhaWxcbiAgICAgICAgLy8gY2xvc2VkIGFuZCBrZWVwIHNjYW5uaW5nIHBhc3QgdGhlIG9wZXJhdG9yLlxuICAgICAgICBpICs9IG9wTGVuO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IGNtZFN0YXJ0LCBvcGVuZXJMaW5lRW5kLCBkZWxpbSwgdGFiU3RyaXAsIHF1b3RlZERlbGltOiBzYXdRdW90ZSB9O1xuICAgIH1cbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIGJvZHkgb2YgYW4gb3BlbmVyIHJ1bnMgZnJvbSBhZnRlciB0aGUgb3BlbmVyIGxpbmUncyBuZXdsaW5lIHRvIHRoZSBsaW5lXG4gKiB0aGF0IGlzIGV4YWN0bHkgdGhlIGRlbGltaXRlciAoYDw8YCksIG9yIGl0cyBsZWFkaW5nLXRhYi1zdHJpcHBlZCBmb3JtXG4gKiAoYDw8LWApLCB0cmFpbGluZyB3aGl0ZXNwYWNlIGFsbG93ZWQuIFJldHVybnMgdGhlIGNsb3NlcidzIGxpbmUgYm91bmRzLCBvclxuICogbnVsbCB3aGVuIG5vIGNsb3NlciBleGlzdHMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0Nsb3NlcihyYXc6IHN0cmluZywgb3BlbjogSGVyZWRvY09wZW5lcik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCBuID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IG47XG4gIGxldCBsaW5lUG9zID0gYm9keVN0YXJ0O1xuICB3aGlsZSAobGluZVBvcyA8IG4pIHtcbiAgICBjb25zdCBubCA9IHJhdy5pbmRleE9mKCdcXG4nLCBsaW5lUG9zKTtcbiAgICBjb25zdCBsaW5lRW5kID0gbmwgPT09IC0xID8gbiA6IG5sO1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG9wZW4udGFiU3RyaXAgPyByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCkucmVwbGFjZSgvXlxcdCsvLCAnJykgOiByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCk7XG4gICAgaWYgKFxuICAgICAgY2FuZGlkYXRlID09PSBvcGVuLmRlbGltIHx8XG4gICAgICAoY2FuZGlkYXRlLnN0YXJ0c1dpdGgob3Blbi5kZWxpbSkgJiYgL15bIFxcdF0qJC8udGVzdChjYW5kaWRhdGUuc2xpY2Uob3Blbi5kZWxpbS5sZW5ndGgpKSlcbiAgICApIHtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogbGluZVBvcywgbGluZUVuZCB9O1xuICAgIH1cbiAgICBpZiAobmwgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBsaW5lUG9zID0gbmwgKyAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE1hc2sgZXZlcnkgaGVyZWRvYyBvdXQgb2YgdGhlIHJhdyBjb21tYW5kIHN0cmluZywgcmV0dXJuaW5nIHRoZSBib2RpZXMgYW5kXG4gKiBvcGVuZXJzIGZvciByZS1hc3NvY2lhdGlvbiBieSBpbmRleC4gVGhlIG1hc2sgY292ZXJzXG4gKiBgW2NtZFN0YXJ0LCBjbG9zZXJMaW5lRW5kKWAgXHUyMDE0IHRoZSBvcGVuZXIgbGluZSB0aHJvdWdoIHRoZSBjbG9zZXIgbGluZSwgdGhlXG4gKiBjbG9zZXIncyBuZXdsaW5lIGV4Y2x1ZGVkIFx1MjAxNCBzbyBhIGNvbW1hbmQgam9pbmVkIGJlZm9yZSB0aGUgb3BlbmVyXG4gKiAoYGNtZDEgJiYgY2F0IDw8RU9GYCkga2VlcHMgaXRzIHN0cnVjdHVyZSwgYW5kIHRoZSBwbGFjZWhvbGRlciBzdGFuZHMgYWxvbmVcbiAqIGFzIGl0cyBvd24gc2ltcGxlIGNvbW1hbmQuIEEgaGVyZWRvYyB3aXRob3V0IGEgY2xvc2VyIGZhaWxzIGNsb3NlZDogaXRzXG4gKiBvcGVuZXIgbGluZSBzdGF5cyB1bm1hc2tlZCBhbmQgc2Nhbm5pbmcgcmVzdW1lcyBhZnRlciBpdC5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBvcGVuID0gZmluZEhlcmVkb2NPcGVuZXIocmF3LCBjdXJzb3IpO1xuICAgIGlmIChvcGVuID09PSBudWxsKSBicmVhaztcbiAgICBjb25zdCBjbG9zZSA9IGhlcmVkb2NDbG9zZXIocmF3LCBvcGVuKTtcbiAgICBpZiAoY2xvc2UgPT09IG51bGwpIHtcbiAgICAgIGN1cnNvciA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgbGV0IGJvZHkgPSByYXcuc2xpY2UoYm9keVN0YXJ0LCBjbG9zZS5saW5lU3RhcnQpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgaWYgKG9wZW4udGFiU3RyaXApIGJvZHkgPSBib2R5LnJlcGxhY2UoL15cXHQrL2dtLCAnJyk7XG4gICAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IsIG9wZW4uY21kU3RhcnQpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgd3JpdGVzLnB1c2goeyBvcGVuZXI6IHJhdy5zbGljZShvcGVuLmNtZFN0YXJ0LCBvcGVuLm9wZW5lckxpbmVFbmQpLCBib2R5LCBxdW90ZWREZWxpbTogb3Blbi5xdW90ZWREZWxpbSB9KTtcbiAgICBjdXJzb3IgPSBjbG9zZS5saW5lRW5kO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWRpcmVjdC10b2tlbiBhbmFseXNpcyBhbmQgdGhlIHdyaXRlLXRvdWNoIGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuMSwgXHUwMEE3NS4yKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmVkaXJlY3RJbmZvIHtcbiAgLyoqIElPX05VTUJFUiBmZCAoYDE+YC9gMj5gKSwgb3IgbnVsbCB3aGVuIGltcGxpY2l0LiAqL1xuICBmZDogbnVtYmVyIHwgbnVsbDtcbiAgLyoqIFRoZSBvcGVyYXRvci4gKi9cbiAgb3A6ICc+JyB8ICc+PicgfCAnJj4nIHwgJyY+PicgfCAnPiYnIHwgJzwnIHwgJzw8JyB8ICc8PC0nIHwgJzw8PCc7XG4gIC8qKiBBdHRhY2hlZCB0YXJnZXQgdGV4dCwgb3IgbnVsbCBmb3IgYSBzdGFuZGFsb25lIG9wZXJhdG9yICh0YXJnZXQgPSBuZXh0IHRva2VuKS4gKi9cbiAgdGFyZ2V0OiBzdHJpbmcgfCBudWxsO1xufVxuXG5jb25zdCBSRURJUkVDVF9UT0tFTiA9IC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC87XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0ZXh0OiBzdHJpbmcpOiBSZWRpcmVjdEluZm8gfCBudWxsIHtcbiAgY29uc3QgbSA9IHRleHQubWF0Y2goUkVESVJFQ1RfVE9LRU4pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssIGZkVGV4dCwgb3AsIHRhcmdldF0gPSBtO1xuICByZXR1cm4ge1xuICAgIGZkOiBmZFRleHQgPT09ICcnID8gbnVsbCA6IE51bWJlci5wYXJzZUludChmZFRleHQsIDEwKSxcbiAgICBvcDogb3AgYXMgUmVkaXJlY3RJbmZvWydvcCddLFxuICAgIHRhcmdldDogdGFyZ2V0ID09PSAnJyA/IG51bGwgOiB0YXJnZXRcbiAgfTtcbn1cblxuLyoqXG4gKiBBIGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0IChwbGFuIFx1MDBBNzUuMSk6IGZkLTEgYD5gL2A+PmAgKGV4cGxpY2l0IGAxPmAvYDE+PmBcbiAqIGluY2x1ZGVkKSBhbmQgYCY+YC9gJj4+YC4gRkQtbnVtYmVyZWQgKGAyPmApLCBkdXAgKGAyPiYxYCwgYD4mZmApLFxuICogYCZgLWxlYWRpbmctdGFyZ2V0IGR1cCAoYD4mYCkgYW5kIHN0ZGluIChgPGApIGZvcm1zIG5ldmVyIHByb2R1Y2UgY29udGVudC5cbiAqL1xuZnVuY3Rpb24gaXNDb250ZW50UmVkaXJlY3QocjogUmVkaXJlY3RJbmZvKTogYm9vbGVhbiB7XG4gIGlmIChyLm9wID09PSAnPicgfHwgci5vcCA9PT0gJz4+Jykge1xuICAgIGlmIChyLmZkICE9PSBudWxsICYmIHIuZmQgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoci50YXJnZXQ/LnN0YXJ0c1dpdGgoJyYnKSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiByLm9wID09PSAnJj4nIHx8IHIub3AgPT09ICcmPj4nO1xufVxuXG4vKiogVGhlIGFyZ3Ygc3RyZWFtIGFuZCByZWRpcmVjdCBsaXN0IG9mIGEgc2ltcGxlIGNvbW1hbmQgKHBsYW4gXHUwMEE3NS4xMCk6IHdvcmRzIG1pbnVzIHJlZGlyZWN0IHRva2VucyBhbmQgdGhlaXIgdGFyZ2V0cy4gKi9cbmZ1bmN0aW9uIGFuYWx5emVUb2tlbnModG9rZW5zOiBUb2tlbltdKTogeyBhcmd2OiBzdHJpbmdbXTsgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSB9IHtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZm8gPSBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odG9rZW4udGV4dCk7XG4gICAgaWYgKGluZm8gPT09IG51bGwpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5mby50YXJnZXQgPT09IG51bGwpIHtcbiAgICAgIC8vIEEgc3RhbmRhbG9uZSBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0IChvclxuICAgICAgLy8gaGVyZWRvYyBkZWxpbWl0ZXIgLyBoZXJlLXN0cmluZyBjb250ZW50KSBcdTIwMTQgYXR0YWNoZWQgdG8gdGhlIHJlZGlyZWN0XG4gICAgICAvLyBzbyB0aGUgd3JpdGUgZ3JhbW1hcnMgc2VlIGl0LCBhbmQgZXhjbHVkZWQgZnJvbSBhcmd2LlxuICAgICAgY29uc3QgbmV4dCA9IHRva2Vuc1tpICsgMV07XG4gICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFuZXh0LmlzUmVkaXJlY3QpIHtcbiAgICAgICAgcmVkaXJlY3RzLnB1c2goeyAuLi5pbmZvLCB0YXJnZXQ6IG5leHQudGV4dCB9KTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVkaXJlY3RzLnB1c2goaW5mbyk7XG4gIH1cbiAgcmV0dXJuIHsgYXJndiwgcmVkaXJlY3RzIH07XG59XG5cbi8qKlxuICogTGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgY29udGVudCAocGxhbiBcdTAwQTc1LjEpIGZvciBib2R5IHRocmVhZGluZzogbm9cbiAqIGZsYWdzLCBubyBzaGVsbCBleHBhbnNpb24sIG5vIGdsb2JzOyBgcHJpbnRmYCBvbmx5IHdoZW4gdGhlIGZvcm1hdCBoYXMgbm9cbiAqIGAlYC9iYWNrc2xhc2ggZGlyZWN0aXZlcyAodGhlbiB0aGUgZm9ybWF0IGl0c2VsZiBpcyB0aGUgbGl0ZXJhbCBjb250ZW50KS5cbiAqIFRocmVhZGVkIG9uIGFwcGVuZHMgYXMgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBhbmQgb24gc2luZ2xlIHBsYWluIGA+YFxuICogb3ZlcndyaXRlcyAoYW5kIHRlZSBvcGVyYW5kcyB3aXRoIGEgb25lLWhvcCBsaXRlcmFsIHBpcGUgc291cmNlKSBhcyB0aGVcbiAqIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGxpdGVyYWxDb250ZW50KGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGFyZ3MgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoYXJncy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGhhc1NoZWxsRXhwYW5zaW9uKGEpIHx8IC9bKj9dLy50ZXN0KGEpKSByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChob3N0ID09PSAncHJpbnRmJykge1xuICAgIGlmIChhcmdzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBmbXQgPSBhcmdzWzBdO1xuICAgIGlmIChmbXQuaW5jbHVkZXMoJyUnKSB8fCBmbXQuaW5jbHVkZXMoJ1xcXFwnKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gZm10O1xuICB9XG4gIHJldHVybiBgJHthcmdzLmpvaW4oJyAnKX1cXG5gO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWRpcmVjdCB0YXJnZXQgYWdhaW5zdCB0aGUgY3VycmVudCBkaXJlY3RvcnksIGVtaXR0aW5nIHRoZVxuICogdW5yZXNvbHZlZCB2ZXJkaWN0ICh0aGUgcmVhZCBpZGlvbXMnIHJlYXNvbikgd2hlbiB0aGUgcGF0aCBjYXJyaWVzIGFuXG4gKiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2IuIFJldHVybnMgdGhlIGFic29sdXRlIHBhdGgsIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVUYXJnZXQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgdGFyZ2V0OiBzdHJpbmcsIGN1cnJlbnREaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgIGlkaW9tLFxuICAgICAgZmlsZUFyZzogdGFyZ2V0LFxuICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG59XG5cbi8qKiBUaGUgYHRlZWAgb3BlcmFuZCBncmFtbWFyOiBhcHBlbmQgbW9kZSBhbmQgb3BlcmFuZCBsaXN0OyB1bmtub3duIG9wdGlvbnMgcmV0dXJuIG51bGwgKGZhaWwgY2xvc2VkKS4gKi9cbmZ1bmN0aW9uIHRlZU9wZXJhbmRQYXJ0cyhhcmd2OiBzdHJpbmdbXSk6IHsgYXBwZW5kOiBib29sZWFuOyBvcGVyYW5kczogc3RyaW5nW10gfSB8IG51bGwge1xuICBsZXQgYXBwZW5kID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJndi5zbGljZSgxKSkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1hJyB8fCBhID09PSAnLS1hcHBlbmQnKSB7XG4gICAgICBhcHBlbmQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIG51bGw7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBhcHBlbmQsIG9wZXJhbmRzIH07XG59XG5cbi8qKlxuICogVGhlIGB0ZWVgIG9wZXJhbmQgd3JpdGVzIChwbGFuIFx1MDBBNzUuMSk6IGVhY2ggb3BlcmFuZCBpcyBhIHdob2xlLWZpbGVcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKHRydW5jYXRpbmcpLCBvciBhIHdob2xlLWZpbGUgYXBwZW5kIHVuZGVyIGAtYWAvYC0tYXBwZW5kYC5cbiAqIEEgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChgZWNobyB4IHwgdGVlIGZgLCBgcHJpbnRmIHkgfFxuICogdGVlIC1hIGZgLCBwbGFuIFx1MDBBNzUuMikgdGhyZWFkcyBhcyB0aGUgd3JpdHRlbiBib2R5IFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzXG4gKiBwb3N0LWNvbnRlbnQgb24gdGhlIHRydW5jYXRpbmcgd3JpdGUsIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZDtcbiAqIHdpdGhvdXQgYSBrbm93biBzb3VyY2UgbmVpdGhlciBvcCBjYXJyaWVzIHdyaXR0ZW4gY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hUZWVPcGVyYW5kcyhcbiAgYXJndjogc3RyaW5nW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSB0ZWVPcGVyYW5kUGFydHMoYXJndik7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCkgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2YgcGFydHMub3BlcmFuZHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIG9wZXJhbmQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgIHNwYW46ICFwYXJ0cy5hcHBlbmRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJlZGlyZWN0IGZhbWlseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuMSksIHJ1biBmb3IgZXZlcnkgc2ltcGxlIGNvbW1hbmQgYWZ0ZXJcbiAqIHRoZSByZWFkIG1hdGNoZXJzOiBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdHMgb24gYGVjaG9gL2BwcmludGZgL2B0ZWVgXG4gKiB3cml0ZSB3aG9sZS1maWxlOyBhIGJhcmUgYD4gZmAgLyBgOiA+IGZgIHRydW5jYXRlcyAodGhlIG1haW4gd2FsayBoYW5kc1xuICogYXJndi1lbXB0eSBjb21tYW5kcyBkaXJlY3RseSBoZXJlKTsgYD4+YC1vbmx5IHRydW5jYXRpb24gZm9ybXMgYXBwZW5kXG4gKiBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nLiBBbnkgb3RoZXIgaG9zdCB3aXRoIGEgY29udGVudCByZWRpcmVjdCAoYGxzID4gZmAsXG4gKiBgcHl0aG9uMyB4LnB5ID4gb3V0YCwgYGNhdCBmID4gZ2ApIGdldHMgbm8gd3JpdGUgdG91Y2ggXHUyMDE0IHRoZSByZWRpcmVjdCBpc1xuICogcmVhbCwgYnV0IGl0cyBjb250ZW50IGlzIGR5bmFtaWMgYW5kIG91dCBvZiBzY29wZS5cbiAqXG4gKiBCb2R5IHRocmVhZGluZzogZXhhY3RseSBvbmUgcGxhaW4gYD4+YCAob3IgYDE+PmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gYVxuICogZnVsbHkgbGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgdGhyZWFkcyB0aGUgd3JpdHRlbiBib2R5ICh0aGUgc3VmZml4IGdhdGUpLFxuICogYW5kIGV4YWN0bHkgb25lIHBsYWluIGA+YCAob3IgYDE+YCkgY29udGVudCByZWRpcmVjdCBvbiB0aGUgc2FtZSBsaXRlcmFsc1xuICogdGhyZWFkcyBpdCBhcyB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCAocGxhbiBcdTAwQTczIHN0ZXAgMWIgXHUyMDE0IHRoZVxuICogY29udGVudCBsYXllciBpcyB3aGF0IHN1cHByZXNzZXMgYGVjaG8gaGkgPiByZWFkLW9ubHktZmlsZWAsIHdoZXJlIHRoZVxuICogZmlsZSBzdGF5cyBwcmVzZW50IGJ1dCB1bmNoYW5nZWQpLiBgJj5gL2AmPj5gLCBtdWx0aS1yZWRpcmVjdCBjb21tYW5kcyxcbiAqIGFuZCBgdGVlYCdzIG93biByZWRpcmVjdHMgbmV2ZXIgdGhyZWFkLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlZGlyZWN0RmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDApIHtcbiAgICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gdW5kZWZpbmVkIHx8IGhvc3QgPT09ICc6JyB8fCBob3N0ID09PSAnZXhlYycpIHtcbiAgICAvLyBCYXJlIGA+IGZgLCBgOiA+IGZgIGFuZCBgZXhlYyA+IGZgIHRydW5jYXRlIChleGVjIGFwcGxpZXMgdGhlIHJlZGlyZWN0XG4gICAgLy8gdG8gdGhlIHNoZWxsJ3Mgb3duIGZkIDEgaW1tZWRpYXRlbHkgXHUyMDE0IHRoZSBmZC0xIHRhcmdldCBpcyBzdGF0aWMsIHNvIHRoZVxuICAgIC8vIHRydW5jYXRpb24gaGFwcGVucyBldmVuIHRob3VnaCB0aGUgY29tbWFuZCBuZXZlciB3cml0ZXMpO1xuICAgIC8vIGA+PmAvYCY+PmAgYXBwZW5kIG5vdGhpbmcgXHUyMTkyIG5vIHRvdWNoLlxuICAgIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+JyB8fCByLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICd0cnVuY2F0ZS13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3RydW5jYXRlLXdyaXRlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJyAmJiBob3N0ICE9PSAndGVlJykgcmV0dXJuO1xuICBjb25zdCBzaW5nbGVQbGFpbkFwcGVuZCA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+Pic7XG4gIGNvbnN0IHNpbmdsZVBsYWluT3ZlcndyaXRlID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4nO1xuICBjb25zdCB0aHJlYWRlZEFwcGVuZCA9IHNpbmdsZVBsYWluQXBwZW5kICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRocmVhZGVkT3ZlcndyaXRlID0gc2luZ2xlUGxhaW5PdmVyd3JpdGUgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICBpZiAoci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkQXBwZW5kICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkQXBwZW5kIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkT3ZlcndyaXRlICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkT3ZlcndyaXRlIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZpbGUtbXV0YXRpb24gZmFtaWx5IGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuM1x1MjAxM1x1MDBBNzUuNyk6IGNwL2luc3RhbGwvbXYvZ2l0IG12LFxuLy8gcm0vZ2l0IHJtL3RydW5jYXRlLCBzZWQgLWkgaW4tcGxhY2UgZWRpdHMsIGFuZCBwYXRjaC9naXQgYXBwbHkuIFRoZXkgc2hhcmVcbi8vIHRoZSBcdTAwQTc1IGZhaWwtY2xvc2VkIHJ1bGVzOiBsZWFkaW5nIGVudiBhc3NpZ25tZW50cyAoc3RyaXBwZWQgYnkgdGhlIHdhbGspXG4vLyBhbmQgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIGFyZSBza2lwcGVkIChtZWNoYW5pY2FsbHkgY2VydGFpbik7IGFueVxuLy8gb3RoZXIgd3JhcHBlciBpcyB1bnJlc29sdmVkOyBhIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uXG4vLyBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbjsgYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kczsgZ2xvYmJlZCBvciB2YXJpYWJsZVxuLy8gcGF0aHMgYXJlIHVucmVzb2x2ZWQ7IGRpcmVjdG9yeS1zaGFwZWQgc291cmNlIG9wZXJhbmRzIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXcmFwcGVyIHdvcmRzIHRoYXQgb2JzY3VyZSB0aGUgd3JhcHBlZCBjb21tYW5kJ3MgYXJndiAocGxhbiBcdTAwQTc1KTogYSBmYW1pbHkgY29tbWFuZCBiZWhpbmQgb25lIGlzIHVucmVzb2x2ZWQsIG5ldmVyIGd1ZXNzZWQuICovXG5jb25zdCBGT1JFSUdOX1dSQVBQRVJTID0gbmV3IFNldChbJ3N1ZG8nLCAneGFyZ3MnLCAnbm9odXAnLCAndGltZScsICduaWNlJywgJ2RvYXMnXSk7XG5cbi8qKiBBIGxlYWRpbmcgYE5BTUU9dmFsdWVgIGFzc2lnbm1lbnQgdG9rZW4gKGBlbnYgRk9PPWJhciBjcCBhIGJgIGtlZXBzIG9uZSBhZnRlciB0aGUgd3JhcHBlciB3b3JkKS4gKi9cbmNvbnN0IEFTU0lHTk1FTlRfVE9LRU4gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqXG4gKiBTdHJpcCBhdCBtb3N0IG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBcdTIwMTQgbWVjaGFuaWNhbGx5IHRyYW5zcGFyZW50IChwbGFuXG4gKiBcdTAwQTc1KSBcdTIwMTQgYW5kIGFueSBsZWFkaW5nIGFzc2lnbm1lbnRzIGFmdGVyIGl0OiBgZW52IEZPTz1iYXIgY3AgYSBiYCBzZXRzIEZPT1xuICogdGhlbiBydW5zIGNwLCBleGFjdGx5IHRoZSB0cmFuc3BhcmVudC1wcmVmaXggY2xhc3MgdGhlIHdhbGsgc3RyaXBzIGJlZm9yZVxuICogdG9rZW5pemluZyAoYEZPTz1iYXIgZW52IGNwIGEgYmAgYXJyaXZlcyBoZXJlIHdpdGggdGhlIGFzc2lnbm1lbnRzIGFscmVhZHlcbiAqIGdvbmUpLlxuICovXG5mdW5jdGlvbiBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgdW53cmFwcGVkID0gYXJndlswXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbMF0gPT09ICdlbnYnID8gYXJndi5zbGljZSgxKSA6IGFyZ3Y7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB1bndyYXBwZWQubGVuZ3RoICYmIEFTU0lHTk1FTlRfVE9LRU4udGVzdCh1bndyYXBwZWRbaV0pKSBpICs9IDE7XG4gIHJldHVybiBpID4gMCA/IHVud3JhcHBlZC5zbGljZShpKSA6IHVud3JhcHBlZDtcbn1cblxuZnVuY3Rpb24gcHVzaFVucmVzb2x2ZWQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgZmlsZUFyZzogc3RyaW5nLCByZWFzb246IHN0cmluZyk6IHZvaWQge1xuICByZXN1bHRzLnB1c2goeyBzdGF0dXM6ICd1bnJlc29sdmVkJywgaWRpb20sIGZpbGVBcmcsIHJlYXNvbiB9KTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5ICh0aGUgZGVzdC1kaXIgZGVjaXNpb24sIHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNDsgZnMgc3RhdCBsaWtlIHRoZSByZWFkIGlkaW9tcycgbGluZSBjb3VudHMpLiAqL1xuZnVuY3Rpb24gaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRGlyZWN0b3J5KCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzaGFyZWQgY3AvaW5zdGFsbC9tdiBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNCk6IHBlci1mYW1pbHkgb3B0aW9uXG4gKiBzZXRzIGFuZCB0b3VjaCBvcGVyYXRpb25zIGJlaGluZCBvbmUgcGFyc2VyLlxuICovXG5pbnRlcmZhY2UgQ29weU1vdmVTcGVjIHtcbiAgaWRpb206ICdjcC13cml0ZScgfCAnaW5zdGFsbC13cml0ZScgfCAnbXYtd3JpdGUnO1xuICAvKiogS25vd24gbm8tdmFsdWUgZmxhZ3MgKGNvbnN1bWVkLCBuZXZlciBvcGVyYW5kcykuICovXG4gIG5vVmFsdWU6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKlxuICAgKiBOby1jbG9iYmVyIGZsYWdzIChgY3AgLW5gL2AtLW5vLWNsb2JiZXJgKTogY29uc3VtZWQgbGlrZSBuby12YWx1ZSBmbGFncyxcbiAgICogYnV0IHRoZSB3cml0ZSBzdGlsbCBwYXJzZXMgXHUyMDE0IHRoZSBza2lwIGlzIGludmlzaWJsZSB0byB0aGUgcG9zdC1jb21tYW5kXG4gICAqIGJ5dGUtY29tcGFyZSBnYXRlLCB3aGljaCBjYW5ub3QgZGlzdGluZ3Vpc2ggYSByZWFsIGNvcHkgZnJvbSBhIHByZS1leGlzdGluZ1xuICAgKiBlcXVhbCBkZXN0ICh0aGUgZG9jdW1lbnRlZCBuby1vcCByZXNpZHVlLCBwaW5uZWQgaW5cbiAgICogYmFzaC13cml0ZS1pbnRlZ3JhdGlvbi50ZXN0LnRzKS5cbiAgICovXG4gIG5vQ2xvYmJlcjogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEtub3duIHZhbHVlLXRha2luZyBmbGFncyAodGhlIG5leHQgd29yZCBpcyB0aGUgdmFsdWUgXHUyMDE0IGAtdCBESVJgLCBvciBhbiBpbnN0YWxsIG1vZGUvb3duZXIvZ3JvdXApLiAqL1xuICB2YWx1ZVRha2luZzogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEZsYWdzIHRoYXQgZmFpbCB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKGBjcCAtYmAvYC0tYmFja3VwYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgZHJ5LXJ1biBgLW5gL2AtLWRyeS1ydW5gKS4gKi9cbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBUaGUgcGVyLXNvdXJjZSB0b3VjaDogY3AvaW5zdGFsbCByZWFkIHRoZWlyIHNvdXJjZXM7IG12IGRlbGV0ZXMgdGhlbS4gKi9cbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcgfCAnZGVsZXRlJztcbiAgLyoqIFRoZSBwZXItZGVzdCB0b3VjaDogY3AvaW5zdGFsbCBvdmVyd3JpdGU7IG12IHJlbmFtZS1jb3BpZXMuICovXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdyZW5hbWUtY29weSc7XG59XG5cbmNvbnN0IENQX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdjcC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctcicsICctUicsICctcCcsICctZicsICctdicsICctaScsICctdScsICctYScsICctZCcsICctTCcsICctUCddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KFsnLW4nLCAnLS1uby1jbG9iYmVyJ10pLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctYicsICctLWJhY2t1cCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgSU5TVEFMTF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnaW5zdGFsbC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctRCcsICctcycsICctdiddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5JywgJy1tJywgJy1vJywgJy1nJ10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1kJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBNVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICAvLyBgbXYgLW5gIHN0YXlzIGluIG5vVmFsdWUsIG5vdCBub0Nsb2JiZXI6IGFuIG12IHNraXAgbGVhdmVzIHRoZSBzb3VyY2UgaW5cbiAgLy8gcGxhY2UsIGFuZCB0aGUgZGVsZXRlJ3Mgb3duIGFic2VuY2UgZ2F0ZSB0aGVuIGZhaWxzIHRoZSB0b3VjaCBcdTIwMTQgdGhlXG4gIC8vIG5vLWNsb2JiZXIgYmxpbmQgc3BvdCBpcyBjcCdzIGJ5dGUtY29tcGFyZSwgbm90IG12J3MuXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaScsICctbicsICctdicsICctdSddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldCgpLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5jb25zdCBHSVRfTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1rJywgJy12J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoKSxcbiAgLy8gYGdpdCBtdiAtbmAvYC0tZHJ5LXJ1bmAgaXMgYSB0cmlhbCBydW4gdGhhdCBtb3ZlcyBub3RoaW5nICh0aGUgc2FtZVxuICAvLyByZWFkLW9ubHkgY2xhc3MgYXMgYHBhdGNoIC0tZHJ5LXJ1bmAsIHBsYW4gXHUwMEE3NS43KSBcdTIwMTQgZmFpbCBjbG9zZWQuXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLW4nLCAnLS1kcnktcnVuJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5pbnRlcmZhY2UgQ29weU1vdmVQYXJ0cyB7XG4gIC8qKiBPcGVyYW5kcyBpbiBvcmRlciAoc291cmNlczsgaW4gdGhlIG5vbi1gLXRgIGZvcm0gdGhlIGxhc3QgaXMgdGhlIGRlc3QpLiAqL1xuICBvcGVyYW5kczogc3RyaW5nW107XG4gIC8qKiBUaGUgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5YCB2YWx1ZSwgb3IgbnVsbC4gKi9cbiAgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFBhcnNlIHRoZSBvcGVyYW5kcyBvZiBhIGNwL2luc3RhbGwvbXYgY29tbWFuZDoga25vd24gb3B0aW9ucyBhcmUgY29uc3VtZWQsXG4gKiBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzLCBhbmQgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5Wz1ESVJdYCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgbmV4dCB3b3JkIGlzIHRoZSB0YXJnZXQgZGlyZWN0b3J5LCBuZXZlciBhIHNvdXJjZS4gQVxuICogbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb24gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb24gKG5vXG4gKiB0b3VjaCkuIFJldHVybnMgbnVsbCB3aGVuIGEgZmFpbC1jbG9zZWQgb3B0aW9uIGlzIHByZXNlbnQgb3IgYSB2YWx1ZS10YWtpbmdcbiAqIGZsYWcgaXMgbGVmdCB2YWx1ZWxlc3MuXG4gKi9cbmZ1bmN0aW9uIGNvcHlNb3ZlUGFydHMoYXJnczogc3RyaW5nW10sIHNwZWM6IENvcHlNb3ZlU3BlYyk6IENvcHlNb3ZlUGFydHMgfCBudWxsIHtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCB0YXJnZXREaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgaSA9IDA7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIHdoaWxlIChpIDwgYXJncy5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctdCcgfHwgYSA9PT0gJy0tdGFyZ2V0LWRpcmVjdG9yeScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgdGFyZ2V0RGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXRhcmdldC1kaXJlY3Rvcnk9JykpIHtcbiAgICAgIHRhcmdldERpciA9IGEuc2xpY2UoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nLmxlbmd0aCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMuZXhjbHVkZWQuaGFzKGEpKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoc3BlYy52YWx1ZVRha2luZy5oYXMoYSkpIHtcbiAgICAgIGlmIChhcmdzW2kgKyAxXSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5ub1ZhbHVlLmhhcyhhKSB8fCBzcGVjLm5vQ2xvYmJlci5oYXMoYSkpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4geyBvcGVyYW5kcywgdGFyZ2V0RGlyIH07XG59XG5cbi8qKlxuICogVGhlIHBlci1zb3VyY2UgdG91Y2ggb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQuIGNwL2luc3RhbGwgc291cmNlcyBhcmVcbiAqIHdob2xlLWZpbGUgcmVhZHMgcmVzb2x2ZWQgYWdhaW5zdCBmcyBsaWtlIHRoZSByZWFkIGlkaW9tczsgYSBzb3VyY2Ugd2hvc2VcbiAqIGxpbmUgY291bnQgY2Fubm90IGJlIHJlYWQgYXQgcGFyc2UgdGltZSAobWlzc2luZyBvciB1bnJlYWRhYmxlIFx1MjAxNCB0aGUgcGFyc2VcbiAqIHJ1bnMgcG9zdC1jb21tYW5kLCBzbyBhIHNvdXJjZSB0aGUgY29tcG91bmQncyBvd24gZWFybGllciBgcm1gIGRlbGV0ZWQgaXNcbiAqIGV4YWN0bHkgdGhpcykgc3RpbGwgcmVzb2x2ZXMgYXMgYSByYW5nZS1sZXNzIHdob2xlLWZpbGUgcmVhZDogdGhlIGRyaXZlclxuICogcGFpcnMgdGhlIGRlc3RpbmF0aW9uIGFnYWluc3QgaXQsIHNvIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwXG4gKiAxYikgYW5kIHRoZSByZWFkJ3MgcG9zdC1jb21tYW5kIGV4aXN0ZW5jZSBnYXRlIGFwcGx5IFx1MjAxNCBhbiB1bmV4cGxhaW5lZFxuICogYWJzZW5jZSBmYWlscyB0aGUgY29weSBkZWNpc2l2ZWx5IGFuZCBhIHBoYW50b20gc291cmNlIG5ldmVyIGZpcmVzIHRoZVxuICogZGVzdC4gVGhlIG12IHNvdXJjZSBpcyBhIGRlbGV0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFNvdXJjZVNwYW4oXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBzcGVjOiBDb3B5TW92ZVNwZWMsXG4gIGFic29sdXRlUGF0aDogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAoc3BlYy5zb3VyY2VPcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LCAoKSA9PiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpKTtcbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgc3BhbjpcbiAgICAgIHJhbmdlID09PSBudWxsXG4gICAgICAgID8geyBvcGVyYXRpb246ICdyZWFkJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pblxuICAgICAgICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGNwL2luc3RhbGwvbXYgZmFtaWx5IChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBvcGVyYW5kcyByZXNvbHZlIHRvIHNvdXJjZS9kZXN0XG4gKiBwYWlycyBcdTIwMTQgZWFjaCBzb3VyY2UgaXMgYSByZWFkIChjcC9pbnN0YWxsKSBvciBkZWxldGUgKG12KSwgZWFjaCBkZXN0IGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKGNwL2luc3RhbGwpIG9yIHJlbmFtZS1jb3B5IChtdiksIHNvdXJjZXMgYmVmb3JlIGRlc3RzIGluXG4gKiBkZWNsYXJhdGlvbiBvcmRlci4gQSBkZXN0IHRoYXQgZW5kcyBpbiBgL2Agb3Igc3RhdHMgYXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5XG4gKiBtYXBzIHRvIGBkaXIvYmFzZW5hbWUoc291cmNlKWAgcGVyIHNvdXJjZTsgYC10IERJUmAvYC0tdGFyZ2V0LWRpcmVjdG9yeT1ESVJgXG4gKiBtYXBzIHRoZSBzYW1lIHdheSBhbmQgaXMgdW5yZXNvbHZlZCB3aGVuIGl0cyB2YWx1ZSBpcyBub3QgZGlyZWN0b3J5LXNoYXBlZC5cbiAqIE11bHRpLXNvdXJjZSBjb21tYW5kcyBuZWVkIGEgZGlyZWN0b3J5IGRlc3Q7IGEgZGlyZWN0b3J5LXNoYXBlZCBvclxuICogZ2xvYmJlZC92YXJpYWJsZSBzb3VyY2UsIGEgZ2xvYmJlZC92YXJpYWJsZSBkZXN0LCBvciBhIGZhaWwtY2xvc2VkIG9wdGlvblxuICogKGBjcCAtYmAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGAtbmApIGVtaXRzIG5vIHRvdWNoZXMuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ29weU1vdmVGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IHNwZWM6IENvcHlNb3ZlU3BlYyB8IG51bGwgPSBudWxsO1xuICBsZXQgYXJnczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGRpciA9IGRpckZvclJlc29sdXRpb247XG4gIGlmIChjb21tYW5kID09PSAnY3AnIHx8IGNvbW1hbmQgPT09ICdpbnN0YWxsJyB8fCBjb21tYW5kID09PSAnbXYnKSB7XG4gICAgc3BlYyA9IGNvbW1hbmQgPT09ICdjcCcgPyBDUF9TUEVDIDogY29tbWFuZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogTVZfU1BFQztcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdtdicpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnbXYtd3JpdGUnLCAnbXYnLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNwZWMgPSBHSVRfTVZfU1BFQztcbiAgICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICAgIGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgfVxuICB9IGVsc2UgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgLy8gQSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IGZhaWwgY2xvc2VkIHJhdGhlciB0aGFuIG1pcy1wYXJzZS5cbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBjb25zdCB3cmFwcGVkU3BlYyA9XG4gICAgICB3cmFwcGVkID09PSAnY3AnID8gQ1BfU1BFQyA6IHdyYXBwZWQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IHdyYXBwZWQgPT09ICdtdicgPyBNVl9TUEVDIDogbnVsbDtcbiAgICBpZiAod3JhcHBlZFNwZWMgIT09IG51bGwpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHdyYXBwZWRTcGVjLmlkaW9tLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoc3BlYyA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gIGNvbnN0IHBhcnRzID0gY29weU1vdmVQYXJ0cyhhcmdzLCBzcGVjKTtcbiAgaWYgKHBhcnRzID09PSBudWxsIHx8IHBhcnRzLm9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIC8vIFJlc29sdmUgZXZlcnkgc291cmNlIGJlZm9yZSBlbWl0dGluZyBhbnl0aGluZzogYSBkaXJlY3Rvcnktc2hhcGVkLFxuICAvLyBnbG9iYmVkLCBvciB2YXJpYWJsZSBzb3VyY2UgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkICh0aGUgZGVzdFxuICAvLyBtYXBwaW5nIGlzIHBlci1zb3VyY2UsIHNvIGFuIHVua25vd2FibGUgc291cmNlIG1ha2VzIHRoZSBkZXN0cyB1bmtub3dhYmxlKS5cbiAgY29uc3Qgc291cmNlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc291cmNlIG9mIHBhcnRzLm9wZXJhbmRzLnNsaWNlKDAsIHBhcnRzLnRhcmdldERpciA9PT0gbnVsbCA/IC0xIDogdW5kZWZpbmVkKSkge1xuICAgIGlmIChzb3VyY2UuZW5kc1dpdGgoJy8nKSkgcmV0dXJuO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgc3BlYy5pZGlvbSwgc291cmNlLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSByZXR1cm47XG4gICAgc291cmNlUGF0aHMucHVzaChhYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgZGVzdFBhdGhzOiBzdHJpbmdbXTtcbiAgaWYgKHBhcnRzLnRhcmdldERpciAhPT0gbnVsbCkge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShwYXJ0cy50YXJnZXREaXIpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXBhcnRzLnRhcmdldERpci5lbmRzV2l0aCgnLycpICYmICFpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKSkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3RoZSAtdCB0YXJnZXQgaXMgbm90IGFuIGV4aXN0aW5nIGRpcmVjdG9yeScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRBYnMgPSByZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcik7XG4gICAgZGVzdFBhdGhzID0gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aCh0YXJnZXRBYnMsIGJhc2VuYW1lKHApKSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgZGVzdCA9IHBhcnRzLm9wZXJhbmRzW3BhcnRzLm9wZXJhbmRzLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShkZXN0KSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRlc3RBYnMgPSByZXNvbHZlUGF0aChkaXIsIGRlc3QpO1xuICAgIGNvbnN0IGRlc3RJc0RpciA9IGRlc3QuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGRlc3RBYnMpO1xuICAgIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPiAxICYmICFkZXN0SXNEaXIpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdhIG11bHRpLXNvdXJjZSBjb3B5L21vdmUgbmVlZHMgYSBkaXJlY3RvcnkgZGVzdGluYXRpb24nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZGVzdFBhdGhzID0gZGVzdElzRGlyID8gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aChkZXN0QWJzLCBiYXNlbmFtZShwKSkpIDogW2Rlc3RBYnNdO1xuICB9XG5cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIGVtaXRTb3VyY2VTcGFuKHJlc3VsdHMsIHNwZWMsIHNvdXJjZVBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogc3BlYy5kZXN0T3BlcmF0aW9uLCBhYnNvbHV0ZVBhdGg6IGRlc3RQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG5jb25zdCBSTV9OT19WQUxVRSA9IG5ldyBTZXQoWyctZicsICctaScsICctdiddKTtcbi8qKiBgcm1gL2BnaXQgcm1gIGZsYWdzIHdob3NlIHNlbWFudGljcyBhcmUgb3V0IG9mIHNjb3BlOiByZWN1cnNpdmUgcmVtb3ZhbCBhbmQgcm1kaXIuICovXG5jb25zdCBSTV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCddKTtcbi8qKiBgZ2l0IHJtYCBhZGRzIHRoZSBkcnktcnVuIGZvcm0gdG8gdGhlIGV4Y2x1c2lvbnMuICovXG5jb25zdCBHSVRfUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnLCAnLW4nLCAnLS1kcnktcnVuJ10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcm0vZ2l0IHJtIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBhIHJlY3Vyc2l2ZS9ybWRpciBmbGFnIChvclxuICogYC0tY2FjaGVkYCBmb3IgZ2l0IHJtIFx1MjAxNCB0aGUgd29ya3RyZWUgZmlsZSBzdXJ2aXZlcykgZXhjbHVkZXMgdGhlIHdob2xlXG4gKiBjb21tYW5kOyBlYWNoIHJlbWFpbmluZyBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgZGVsZXRlLCBhbmQgYVxuICogZGlyZWN0b3J5LXNoYXBlZCBvcGVyYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4gIGV4Y2x1ZGVDYWNoZWQ6IGJvb2xlYW4sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChleGNsdWRlZC5oYXMoYSkgfHwgKGV4Y2x1ZGVDYWNoZWQgJiYgYSA9PT0gJy0tY2FjaGVkJykpIHJldHVybjtcbiAgICBpZiAoUk1fTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdybS13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFN0YXRpY2FsbHkgZXZhbHVhdGUgYW4gYWJzb2x1dGUgYHRydW5jYXRlIC1zYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IGEgcGxhaW5cbiAqIGludGVnZXIgd2l0aCBhbiBvcHRpb25hbCBLL00vRyBzdWZmaXguIFJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLFxuICogYC1yIHJlZmAgdmFsdWVzLCBhbmQgc2hlbGwtZXhwYW5kZWQgdmFsdWVzIGRlcGVuZCBvbiBydW50aW1lIHN0YXRlIFx1MjE5MlxuICogdW5kZWZpbmVkICh0aG9zZSBzcGFucyBnYXRlIGV4aXN0ZW5jZS1vbmx5KS5cbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVTdGF0aWNTaXplKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgbSA9IHZhbHVlLm1hdGNoKC9eKFxcZCspKFtLTUddKT8kLyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBiYXNlID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgY29uc3QgbXVsdCA9IG1bMl0gPT09ICdLJyA/IDEwMjQgOiBtWzJdID09PSAnTScgPyAxMDI0ICoqIDIgOiBtWzJdID09PSAnRycgPyAxMDI0ICoqIDMgOiAxO1xuICByZXR1cm4gYmFzZSAqIG11bHQ7XG59XG5cbi8qKlxuICogVGhlIHRydW5jYXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYC1zIFNJWkVgL2AtciByZWZgIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZVxuICogc2l6ZSB2YWx1ZSBtYXkgaXRzZWxmIGxlYWQgd2l0aCBgLWAgKGB0cnVuY2F0ZSAtcyAtMTAgZmApIFx1MjAxNCBhbmQgYC1jYCBpc1xuICogY29tcGF0aWJsZS4gV2l0aG91dCBgLXNgL2AtcmAgdGhlIGNvbW1hbmQgY2hhbmdlcyBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC4gRWFjaFxuICogZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIHRydW5jYXRlOyBhbiBhYnNvbHV0ZSBgLXMgTmAgY2FycmllcyB0aGUgc3RhdGljYWxseVxuICogZXZhbHVhdGVkIHNpemUgb24gdGhlIHNwYW4gKHRoZSBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQsXG4gKiBgLXMgMGAgXHUyMTkyIGVtcHR5KSwgcmVsYXRpdmUgc2l6ZXMgYW5kIGAtciByZWZgIHN0YXkgZXhpc3RlbmNlLW9ubHkuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHNhd1NpemVGbGFnID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGxldCBzdGF0aWNTaXplOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IG9wZXJhbmRzOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgc2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSBldmFsdWF0ZVN0YXRpY1NpemUoYXJnc1tpICsgMV0pO1xuICAgICAgaSArPSAxOyAvLyBjb25zdW1lIHRoZSBzaXplIHZhbHVlLCBldmVuIHdoZW4gaXQgbGVhZHMgd2l0aCBgLWBcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1yJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IHVuZGVmaW5lZDsgLy8gdGhlIGxhc3Qgc2l6ZSBvcHRpb24gd2luczsgYSByZWYgaGFzIG5vIHN0YXRpYyB2YWx1ZVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgfVxuICBpZiAoIXNhd1NpemVGbGFnKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kLnBhdGgpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAndHJ1bmNhdGUtY29tbWFuZCcsIG9wZXJhbmQucGF0aCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQucGF0aC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3RydW5jYXRlJyxcbiAgICAgICAgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCksXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKG9wZXJhbmQuc2l6ZSAhPT0gdW5kZWZpbmVkID8geyBzaXplOiBvcGVyYW5kLnNpemUgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJtL2dpdCBybS90cnVuY2F0ZSBmYW1pbHkgKHBsYW4gXHUwMEE3NS41KTogYHJtYC9gZ2l0IHJtYCBvcGVyYW5kcyBhcmVcbiAqIGRlbGV0ZXMsIGB0cnVuY2F0ZWAgb3BlcmFuZHMgYXJlIHRydW5jYXRpb25zIChvbmx5IHdoZW4gYC1zYC9gLXJgIGlzXG4gKiBwcmVzZW50KS4gYGdpdCBybSAtLWNhY2hlZGAgdG91Y2hlcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtVHJ1bmNhdGUoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdybScpIHtcbiAgICBtYXRjaFJtT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgUk1fRVhDTFVERUQsIGZhbHNlLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ3RydW5jYXRlJykge1xuICAgIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAncm0nKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgJ3JtJywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBtYXRjaFJtT3BlcmFuZHMoXG4gICAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgICBHSVRfUk1fRVhDTFVERUQsXG4gICAgICAgIHRydWUsXG4gICAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgcmVzdWx0c1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncm0nIHx8IHdyYXBwZWQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncm0nID8gJ3JtLXdyaXRlJyA6ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgYm9keSBvZiBhbiB1bnF1b3RlZCBoZXJlZG9jIGlzIHNoZWxsLWxpdGVyYWwuIFRoZSBzaGVsbCBleHBhbmRzXG4gKiBgJGAgYW5kIGJhY2t0aWNrIHN1YnN0aXR1dGlvbnMgYW5kIHByb2Nlc3NlcyBiYWNrc2xhc2ggZXNjYXBlcyAoYFxcJGAsIGBgIFxcYCBgYCxcbiAqIGBcXFxcYCwgYmFja3NsYXNoLW5ld2xpbmUpIGluIGFuIHVucXVvdGVkIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzIGl0OyBhXG4gKiBiYXJlIGJhY2tzbGFzaCBiZWZvcmUgYW55IG90aGVyIGNoYXIgc3Vydml2ZXMgbGl0ZXJhbGx5LiBBIHF1b3RlZCBkZWxpbWl0ZXJcbiAqIG1ha2VzIHRoZSBib2R5IGxpdGVyYWwgcmVnYXJkbGVzcyBcdTIwMTQgY2hlY2tlZCBieSB0aGUgY2FsbGVyLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQm9keUlzTGl0ZXJhbChib2R5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGJvZHkuaW5jbHVkZXMoJyQnKSB8fCBib2R5LmluY2x1ZGVzKCdgJykpIHJldHVybiBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2R5Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGJvZHlbaV0gIT09ICdcXFxcJykgY29udGludWU7XG4gICAgY29uc3QgbmV4dCA9IGJvZHlbaSArIDFdO1xuICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dCA9PT0gJyQnIHx8IG5leHQgPT09ICdgJyB8fCBuZXh0ID09PSAnXFxcXCcgfHwgbmV4dCA9PT0gJ1xcbicpIHJldHVybiBmYWxzZTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2Mgd3JpdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjIpIGZvciB0aGUgaG9zdCBmYW1pbGllcyB3aG9zZSBib2RpZXMgYXJlXG4gKiBjb250ZW50OiBgY2F0YCAoYm9keSBcdTIxOTIgdGhlIGNvbnRlbnQgcmVkaXJlY3RzKSwgYHRlZWAgKGJvZHkgXHUyMTkyIHRoZSBvcGVyYW5kcyksXG4gKiBhbmQgYHBhdGNoYC9gZ2l0IGFwcGx5YCAoYm9keSBcdTIxOTIgcGF0Y2ggdGV4dCwgXHUwMEE3NS43KS4gQW55IG90aGVyIGhvc3QncyBoZXJlZG9jXG4gKiBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgc3RkaW4tb25seSBhbmQgbm9uLWZhbWlseSBjb21tYW5kc1xuICogKGBweXRob24zIC0gPDxFT0YgPiBvdXRgLCBgbHMgPiBvdXQgPDxFT0ZgKSBnZXQgbm8gd3JpdGUgdG91Y2gsIGFuZFxuICogcmVhZC1mYW1pbHkgY29tbWFuZHMgKGBzZWQgLW4gJzEsMnAnIDw8RU9GYCkgZmFsbCB0aHJvdWdoIHRvIHRoZSByZWFkXG4gKiBtYXRjaGVycy4gRW1wdHkgYD4+YC1ib2RpZXMgYXBwZW5kIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmc7IGVtcHR5IGA+YC1ib2RpZXNcbiAqIHRydW5jYXRlICh3aG9sZS1maWxlLCB0aGUgRjIgcnVsZSkuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGA+PmAgYXBwZW5kcyBhbmQgYD5gIG92ZXJ3cml0ZXMgdGhyZWFkIHRoZSBib2R5IHdoZW4gdGhlXG4gKiBjb250ZW50IHJlZGlyZWN0IGlzIHNpbmdsZSBhbmQgcGxhaW4gXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IG9uIHRoZVxuICogb3ZlcndyaXRlICh0aGUgdHJhaWxpbmcgYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBzIGlzIHJlc3RvcmVkLCBzaW5jZSB0aGVcbiAqIGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzKSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMWIgbGlzdHMgXCJ0ZWUvaGVyZWRvYyB3aXRoIGEgbGl0ZXJhbCBib2R5XCIgaW4gdGhlIGV4YWN0IGNsYXNzKS5cbiAqIEFuIHVucXVvdGVkIGRlbGltaXRlciBsZXRzIHRoZSBzaGVsbCBleHBhbmQgdGhlIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzXG4gKiBpdCwgc28gb25seSBhIGxpdGVyYWwgYm9keSAobm8gYCRgLCBiYWNrdGljaywgb3Igc2hlbGwtcHJvY2Vzc2VkIGJhY2tzbGFzaClcbiAqIHRocmVhZHMgXHUyMDE0IGFuIGV4cGFuZGFibGUgb25lIGRlZ3JhZGVzIHRvIHRoZSBleGlzdGVuY2UtZ2F0ZWQgYWR2aXNvcnkgY2xhc3NcbiAqIHJhdGhlciB0aGFuIHJpc2sgYSBkZWNpc2l2ZS1mYWlsIG9uIGNvbnRlbnQgdGhhdCBuZXZlciByZWFjaGVkIHRoZSBmaWxlLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeUhlcmVkb2NPcGVuZXIoXG4gIG9wZW5lcjogc3RyaW5nLFxuICBib2R5OiBzdHJpbmcsXG4gIHF1b3RlZERlbGltOiBib29sZWFuLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBib2R5TGl0ZXJhbCA9IHF1b3RlZERlbGltIHx8IGhlcmVkb2NCb2R5SXNMaXRlcmFsKGJvZHkpO1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhvcGVuZXIpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybjtcbiAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcblxuICBjb25zdCBlbWl0Q29udGVudFJlZGlyZWN0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5BcHBlbmQgJiYgci5vcCA9PT0gJz4+JyAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAvLyBUaGUgZXhhY3QgZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMsIHNvIHRoZSB0cmFpbGluZ1xuICAgICAgICAgICAgICAgICAgLy8gYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBwZWQgY29tZXMgYmFjayBvbiB0aGUgb3ZlcndyaXRlLlxuICAgICAgICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGlmIChob3N0ID09PSAnY2F0Jykge1xuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykge1xuICAgIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICAgIGlmIChwYXJ0cyAhPT0gbnVsbCkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGlmIChwYXJ0cy5hcHBlbmQpIHtcbiAgICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhbWUgcmVzdG9yZWQtYFxcbmAgZXhhY3QgYm9keSBhcyB0aGUgcmVkaXJlY3QgYnJhbmNoOyBhXG4gICAgICAgICAgICAgICAgICAgIC8vIHRlZSBvcGVyYW5kIHdpdGggYSBjb250ZW50IHJlZGlyZWN0IHByZXNlbnQga2VlcHMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIHJlZGlyZWN0J3MgdGhyZWFkaW5nIG9ubHkgKG1pcnJvciBvZiB0aGUgYXBwZW5kIGJyYW5jaCkuXG4gICAgICAgICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3BhdGNoJyB8fCBob3N0ID09PSAnZ2l0Jykge1xuICAgIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKGFyZ3YsIGJvZHksIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE5vbi1mYW1pbHkgaG9zdDogdGhlIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBubyB3cml0ZSB0b3VjaC5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgc2VkIC1pIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS42KSwgdGhlIGZpcnN0IGNvbnN1bWVyIG9mIGV4YWN0IHJhbmdlczogYVxuLy8gc3Vic3RpdHV0aW9uLW9ubHkgc2NyaXB0IHdpdGggbnVtZXJpYyBhZGRyZXNzZXMgbW9kaWZpZXMgdGhlIGFkZHJlc3NlZFxuLy8gbGluZXM7IGFueXRoaW5nIGxlc3Mgc3RhdGljYWxseSBjZXJ0YWluIGlzIGEgd2hvbGUtZmlsZSBtb2RpZnkuIFRoZVxuLy8gc3VmZml4L3NjcmlwdCBkaXNhbWJpZ3VhdGlvbiBhbmQgdGhlIHNlZ21lbnQgY2xhc3NpZmljYXRpb24gYmVsb3cgYXJlIHRoZVxuLy8gd2hvbGUgb2YgaXQgXHUyMDE0IGV2ZXJ5dGhpbmcgZWxzZSBmb2xsb3dzIHRoZSBzaGFyZWQgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlcy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCAoYE5gLCBgTixNYCkgXHUyMDE0IHRoZSBvbmx5IGZvcm0gd2l0aCBhbiBleGFjdCByYW5nZS4gKi9cbmNvbnN0IE5VTUVSSUNfU1VCU1RJVFVUSU9OID0gL14oXFxkKykoPzosKFxcZCspKT9bc3ldLztcblxuLyoqIEFuIHVuYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IFx1MjAxNCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHdob2xlIGZpbGUgYWRkcmVzc2VkLiAqL1xuY29uc3QgVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTiA9IC9eW3N5XS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3NlZCcpIHtcbiAgICBtYXRjaFNlZElucGxhY2VBcmdzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAnc2VkJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzZWQgLWkgb3BlcmFuZCBncmFtbWFyOiBgLWlgIGJhcmUsIGAtaVNVRkZJWGAgYXR0YWNoZWQsIG9yIGEgc2VwYXJhdGVcbiAqIHN1ZmZpeCB3b3JkIHJlc29sdmVkIGJ5IHRoZSBzdGFuZGFyZCBkaXNhbWJpZ3VhdGlvbiBcdTIwMTQgdGhlIHdvcmQgYWZ0ZXIgYC1pYFxuICogaXMgdGhlIHN1ZmZpeCBvbmx5IHdoZW4gaXQgZG9lcyBub3Qgc3RhcnQgd2l0aCBgLWAsIGlzIG5vdCBzY3JpcHQtc2hhcGVkXG4gKiAoYSBzZWQgY29tbWFuZCBsZXR0ZXIgb3IgYW4gYWRkcmVzcyBzdGFydCBcdTIwMTQgYHMvYS9iL2AsIGAyZGAsIGAveC9kYCksIGFuZCBhXG4gKiBzY3JpcHQgcGx1cyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBpdCAodGhlIEJTRFxuICogc2VwYXJhdGUtc3VmZml4IHJlYWRpbmc7IEdOVSdzIGF0dGFjaGVkLW9ubHkgcmVhZGluZyBvdGhlcndpc2UpLiBBXG4gKiBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUncyByZWFkaW5nOiBgc2VkIC1pIHMvYS9iLyBmIGdgXG4gKiB3b3VsZCBvdGhlcndpc2Ugc3RlYWwgdGhlIGZpcnN0IGZpbGUgb3BlcmFuZCBhcyBhIHN1ZmZpeCBhbmQgc2lsZW50bHkgbWlzc1xuICogaXRzIHdyaXRlICh0aGUgbXVsdGktZmlsZS1zZWQgbWlzcGFyc2UpLiBBbiBhdHRhY2hlZCBvciBkaXNhbWJpZ3VhdGVkXG4gKiBzdWZmaXggaXMgYSBiYWNrdXA6IGEgbm9uLWVtcHR5IHN1ZmZpeCBlbWl0cyBhbiBhZGRpdGlvbmFsIGNyZWF0ZS1vdmVyd3JpdGVcbiAqIHRvdWNoIG9uIGA8ZmlsZT48U1VGRklYPmA7IGFuIGVtcHR5IHN1ZmZpeCAod2hpY2ggdGhlIHF1b3RlLWF3YXJlIHRva2VuaXplclxuICogZHJvcHMgZW50aXJlbHkgXHUyMDE0IGBzZWQgLWkgJycgZmAgYW5kIGBzZWQgLWkgZmAgdG9rZW5pemUgYWxpa2UpIGNyZWF0ZXMgbm9cbiAqIGJhY2t1cC5cbiAqXG4gKiBUaGUgc2NyaXB0IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgcGx1cyBldmVyeSBgLWVgIGFyZ3VtZW50LCBzcGxpdCBvbiBgO2AuXG4gKiBTZWdtZW50cyB0aGF0IGFyZSBhbGwgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9ucyB5aWVsZCB0aGUgZXhhY3QgcmFuZ2VcbiAqIFttaW4gc3RhcnQsIG1pbihtYXggZW5kLCBFT0YpXSAocGVyIGZpbGUsIEVPRiBmcm9tIHRoZSBwb3N0LWVkaXQgY291bnQpO1xuICogc2VnbWVudHMgdGhhdCBhcmUgYWxsIHN1YnN0aXR1dGlvbnMgXHUyMDE0IGFueSBudW1lcmljL3VuYWRkcmVzc2VkIG1peCBcdTIwMTQgYXJlXG4gKiBzdGlsbCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHNvIHRoZSB3aG9sZSBmaWxlIGlzIGFkZHJlc3NlZCAoWzEsIEVPRl0pO1xuICogYW55IGNvdW50LWNoYW5naW5nLCBwYXR0ZXJuLWFkZHJlc3NlZCwgc3RlcCwgb3IgYCRgLWFkZHJlc3NlZCBzZWdtZW50IGlzIGFcbiAqIHdob2xlLWZpbGUgbW9kaWZ5IHdpdGggbm8gcmFuZ2UuIEFuIGFic2VudCBzY3JpcHQgKG5vIHNjcmlwdCBhcmd1bWVudCwgbm9cbiAqIGAtZWApIGlzIHVucmVzb2x2ZWQuXG4gKi9cbi8qKlxuICogQSB3b3JkIHRoYXQgY2FuIG9ubHkgYmUgYSBzZWQgc2NyaXB0LCBuZXZlciBhIEJTRCBzZXBhcmF0ZSBzdWZmaXg6IGEgc2VkXG4gKiBjb21tYW5kIGxldHRlciAoYHNgL2B5YC9gZGAvXHUyMDI2KSwgb3IgYW4gYWRkcmVzcyBzdGFydCAoZGlnaXQsIGAvYCwgYFxcYCwgYCRgLFxuICogYH5gKS4gVGhlIG11bHRpLWZpbGUgZm9ybSBgc2VkIC1pIHMvYS9iLyBmIGdgIHB1dHMgdGhlIHNjcmlwdCBpbW1lZGlhdGVseVxuICogYWZ0ZXIgYmFyZSBgLWlgIChHTlUncyByZWFkaW5nOyB0aGUgQlNEIHJlYWRpbmcgbmVlZHMgYSBzZXBhcmF0ZSBzdWZmaXhcbiAqIHdvcmQgZmlyc3QsIGFuZCBhIGxldHRlci1sZWFkaW5nIG9yIGFkZHJlc3MtbGVhZGluZyB3b3JkIGlzIG5vdCBvbmUpLlxuICovXG5jb25zdCBTRURfU0NSSVBUX1NIQVBFID0gL14oPzpbQS1aYS16XXxcXGR8XFwvfFxcXFx8XFwkfH4pLztcblxuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlQXJncyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN1ZmZpeDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzYXdJbnBsYWNlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgZVNjcmlwdHM6IHN0cmluZ1tdID0gW107XG4gIC8vIFRoZSBzY3JpcHQvZmlsZSBzcGxpdCBvZiB0aGUgcG9zaXRpb25hbHMgaXMgZGVyaXZlZCBhZnRlciB0aGUgc2NhbjogdGhlXG4gIC8vIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBvbmx5IHdoZW4gbm8gYC1lYCBzY3JpcHQgZXhpc3RzIFx1MjAxNFxuICAvLyB3aXRoIGAtZWAgcHJlc2VudCBldmVyeSBwb3NpdGlvbmFsIGlzIGEgZmlsZSAoR05VIHNlZCByZWFkcyB0aGUgc2NyaXB0XG4gIC8vIGZyb20gYC1lYCB0aGVuLCBub3QgZnJvbSB0aGUgZmlyc3QgcG9zaXRpb25hbCkuXG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBGaWxlcyBwdXNoZWQgb3V0c2lkZSB0aGUgcG9zaXRpb25hbCBwYXRoOiBgc2VkIC1pIGZgIChzY3JpcHQgYWJzZW50KS5cbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGEsICd0aGUgLWUgZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBlU2NyaXB0cy5wdXNoKHYpO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWknKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHcgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh3ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gYHNlZCAtaWAgd2l0aCBub3RoaW5nIGFmdGVyOiBubyBzdWZmaXgsIG5vIHNjcmlwdCBcdTIwMTQgdGhlIGFic2VudC1zY3JpcHRcbiAgICAgICAgLy8gY2hlY2sgYmVsb3cgcmVzb2x2ZXMgdGhpcyB1bnJlc29sdmVkLlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHcuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAgIC8vIFRoZSB3b3JkIGFmdGVyIC1pIGlzIGFuIG9wdGlvbiwgbmV2ZXIgYSBzdWZmaXguXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN0QWZ0ZXIgPSBhcmdzLnNsaWNlKGkgKyAyKTtcbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID49IDIgJiYgIVNFRF9TQ1JJUFRfU0hBUEUudGVzdCh3KSkge1xuICAgICAgICAvLyBUaGUgQlNEIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOiB3IGlzIHRoZSBzdWZmaXgsIGFuZCBhIHNjcmlwdCBwbHVzXG4gICAgICAgIC8vIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IFx1MjAxNCBvbmx5IGZvciBhIHN1ZmZpeC1zaGFwZWRcbiAgICAgICAgLy8gd29yZCAoYC5iYWtgLCBgJydgKS4gQSBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUnc1xuICAgICAgICAvLyByZWFkaW5nLCBzbyBgc2VkIC1pIHMvYS9iLyBmIGdgIHRyZWF0cyBgcy9hL2IvYCBhcyB0aGUgc2NyaXB0IGFuZFxuICAgICAgICAvLyBib3RoIGYgYW5kIGcgYXMgZmlsZXMuXG4gICAgICAgIHN1ZmZpeCA9IHc7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAocmVzdEFmdGVyLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBgc2VkIC1pIGZgOiB3IGlzIHRoZSBsYXN0IHRva2VuIFx1MjAxNCBubyBzY3JpcHQgY2FuIGZvbGxvdywgc28gdyBpcyB0aGVcbiAgICAgICAgLy8gZmlsZSBvcGVyYW5kIHdpdGggdGhlIHNjcmlwdCBhYnNlbnQgKEdOVSBpbnN0ZWFkIHJlYWRzIHcgYXMgYSBzY3JpcHRcbiAgICAgICAgLy8gYW5kIGVycm9yczsgZWl0aGVyIHdheSB0aGUgZWRpdCBkb2VzIG5vdCBoYXBwZW4pLlxuICAgICAgICBmaWxlcy5wdXNoKHcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gT25lIHRva2VuIGFmdGVyIHc6IHcgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCAob3IgYSBmaWxlLCB3aGVuIGAtZWBcbiAgICAgIC8vIHNjcmlwdHMgYXJlIHByZXNlbnQpIGFuZCB0aGUgdG9rZW4gaXMgYSBmaWxlIFx1MjAxNCBjb25zdW1lIGJvdGgsIHNvXG4gICAgICAvLyBuZWl0aGVyIGZhbGxzIHRocm91Z2ggdG8gdGhlIHBvc2l0aW9uYWwgcGF0aCBhZ2Fpbi5cbiAgICAgIHBvc2l0aW9uYWxzLnB1c2godywgcmVzdEFmdGVyWzBdKTtcbiAgICAgIGkgKz0gMztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctaScpICYmIGEubGVuZ3RoID4gMikge1xuICAgICAgc2F3SW5wbGFjZSA9IHRydWU7XG4gICAgICBzdWZmaXggPSBhLnNsaWNlKDIpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgLy8gVW5rbm93biBvcHRpb24gXHUyMDE0IG5ldmVyIGEgc2NyaXB0IG9yIGZpbGUuXG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cblxuICBpZiAoIXNhd0lucGxhY2UpIHJldHVybjsgLy8gbm90IGFuIGluLXBsYWNlIGVkaXQgYXQgYWxsXG4gIGNvbnN0IHNjcmlwdEFyZyA9IGVTY3JpcHRzLmxlbmd0aCA9PT0gMCA/IChwb3NpdGlvbmFsc1swXSA/PyBudWxsKSA6IG51bGw7XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMuc2xpY2UoMSkpO1xuICBlbHNlIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMpO1xuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgc2VnbWVudHMucHVzaCguLi5zY3JpcHRBcmcuc3BsaXQoJzsnKSk7XG4gIGZvciAoY29uc3QgcyBvZiBlU2NyaXB0cykgc2VnbWVudHMucHVzaCguLi5zLnNwbGl0KCc7JykpO1xuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZmlsZXNbMF0gPz8gJ3NlZCcsICdubyBzY3JpcHQgKGFic2VudCBvciBlbXB0eSBzY3JpcHQgYXJndW1lbnQpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gU2VnbWVudCBjbGFzc2lmaWNhdGlvbjogZXhhY3Qgd2hlbiBldmVyeSBzZWdtZW50IGlzIGEgbnVtZXJpYy1hZGRyZXNzZWRcbiAgLy8gc3Vic3RpdHV0aW9uOyBleHBsaWNpdCB3aG9sZS1maWxlIFsxLCBFT0ZdIHdoZW4gZXZlcnkgc2VnbWVudCBpcyBzdGlsbCBhXG4gIC8vIHN1YnN0aXR1dGlvbiAoYW55IHVuYWRkcmVzc2VkL251bWVyaWMgbWl4KTsgbm8gcmFuZ2Ugb3RoZXJ3aXNlLlxuICBsZXQgYWxsTnVtZXJpYyA9IHRydWU7XG4gIGxldCBhbGxTdWJzdGl0dXRpb24gPSB0cnVlO1xuICBsZXQgbWluU3RhcnQgPSBJbmZpbml0eTtcbiAgbGV0IG1heEVuZCA9IDA7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgIGNvbnN0IG0gPSBzZWdtZW50Lm1hdGNoKE5VTUVSSUNfU1VCU1RJVFVUSU9OKTtcbiAgICBpZiAobSA9PT0gbnVsbCkge1xuICAgICAgYWxsTnVtZXJpYyA9IGZhbHNlO1xuICAgICAgaWYgKCFVTlJFU1RSSUNURURfU1VCU1RJVFVUSU9OLnRlc3Qoc2VnbWVudCkpIGFsbFN1YnN0aXR1dGlvbiA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IGUgPSBtWzJdID09PSB1bmRlZmluZWQgPyBzIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICBtaW5TdGFydCA9IE1hdGgubWluKG1pblN0YXJ0LCBzKTtcbiAgICBtYXhFbmQgPSBNYXRoLm1heChtYXhFbmQsIGUpO1xuICB9XG5cbiAgZm9yIChjb25zdCBmIG9mIGZpbGVzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGYpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIGYpO1xuICAgIGlmIChhbGxOdW1lcmljIHx8IGFsbFN1YnN0aXR1dGlvbikge1xuICAgICAgY29uc3QgdG90YWwgPSBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgbWlzc2luZyknXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RhcnQgPSBhbGxOdW1lcmljID8gbWluU3RhcnQgOiAxO1xuICAgICAgY29uc3QgZW5kID0gYWxsTnVtZXJpYyA/IE1hdGgubWluKG1heEVuZCwgdG90YWwpIDogdG90YWw7XG4gICAgICBpZiAoc3RhcnQgPiBlbmQpIGNvbnRpbnVlOyAvLyB0aGUgYWRkcmVzc2VkIHJhbmdlIGxpZXMgYmV5b25kIEVPRiBcdTIwMTQgbm90aGluZyBpcyBtb2RpZmllZFxuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoc3VmZml4ICE9PSBudWxsICYmIHN1ZmZpeCAhPT0gJycpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aDogYCR7YWJzb2x1dGVQYXRofSR7c3VmZml4fWAsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGF0Y2ggLyBnaXQgYXBwbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpLiBQYXRjaCB0ZXh0IHNvdXJjZXMsIGluIG9yZGVyIG9mXG4vLyByZWNvZ25pdGlvbjogYSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoYGdpdCBhcHBseSA8ZmlsZT5gIFx1MjAxNCBhIGBwYXRjaGBcbi8vIG9wZXJhbmQgaXMgYSB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlLCBhbmQgaXMgaWdub3JlZCksIHRoZSBzdGRpbiBgPGBcbi8vIHNvdXJjZSAoYHBhdGNoIC1wTiA8IGZpbGVgLCBgZ2l0IGFwcGx5IC0gPCBmaWxlYCksIG9yIGEgaGVyZWRvYyBib2R5XG4vLyAoY2xhc3NpZnlQYXRjaEhlcmVkb2MsIFx1MDBBNzUuMikuIFJlYWQtb25seSBtb2RlcyAoYC0tY2hlY2tgL2AtLXN0YXRgL1xuLy8gYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAsIGBwYXRjaCAtLWRyeS1ydW5gKSBhbmQgaW5kZXgtb25seSBgLS1jYWNoZWRgIHRvdWNoXG4vLyBub3RoaW5nOyBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCAoaXQgcmV3cml0ZXMgcGF0Y2ggcGF0aHMpLiBBIGNvbW1hbmRcbi8vIHdpdGggbm8gc3RhdGljYWxseSBrbm93biBzb3VyY2UgKHBpcGVkIG9yIHRlcm1pbmFsIHN0ZGluLCBhIHZhcmlhYmxlIHBhdGNoXG4vLyBwYXRoKSBpcyB1bnJlc29sdmVkLiBUYXJnZXRzIGFuZCByYW5nZXMgY29tZSBmcm9tIHRoZSBuZXdcbi8vIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAodW5pZmllZC1kaWZmLnRzKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIHNoYXJlZCBgcGF0Y2hgL2BnaXQgYXBwbHlgIG9wdGlvbiBzdXJmYWNlIChwbGFuIFx1MDBBNzUuNyk6IHN0cmlwIGxldmVsLCByZWFkLW9ubHkgYW5kIGluZGV4LW9ubHkgbW9kZXMsIGAtLWRpcmVjdG9yeWAsIGFuZCBvcGVyYW5kcy4gKi9cbmludGVyZmFjZSBQYXRjaEFwcGx5UGFydHMge1xuICBzdHJpcDogUGF0aFN0cmlwO1xuICByZWFkT25seTogYm9vbGVhbjtcbiAgY2FjaGVkT25seTogYm9vbGVhbjtcbiAgZGlyZWN0b3J5OiBib29sZWFuO1xuICBvcGVyYW5kczogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIHBhdGNoQXBwbHlQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgaXNHaXRBcHBseTogYm9vbGVhbik6IFBhdGNoQXBwbHlQYXJ0cyB7XG4gIGxldCBzdHJpcDogUGF0aFN0cmlwID0gaXNHaXRBcHBseSA/IDEgOiAnYXV0byc7XG4gIGxldCByZWFkT25seSA9IGZhbHNlO1xuICBsZXQgY2FjaGVkT25seSA9IGZhbHNlO1xuICBsZXQgZGlyZWN0b3J5ID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICAgIGlmIChhID09PSAnLS1jaGVjaycgfHwgYSA9PT0gJy0tc3RhdCcgfHwgYSA9PT0gJy0tbnVtc3RhdCcgfHwgYSA9PT0gJy0tc3VtbWFyeScpIHtcbiAgICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1jYWNoZWQnKSB7XG4gICAgICAgIGNhY2hlZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1pbmRleCcgfHwgYSA9PT0gJy1SJyB8fCBhID09PSAnLS1yZXZlcnNlJyB8fCBhID09PSAnLS11bnNhZmUtcGF0aHMnIHx8IGEgPT09ICctLXJlamVjdCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGEgPT09ICctLWRpcmVjdG9yeScpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctLWRpcmVjdG9yeT0nKSkge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIHBhdGNoXG4gICAgaWYgKGEgPT09ICctLWRyeS1ydW4nKSB7XG4gICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctTicgfHwgYSA9PT0gJy0tZm9yd2FyZCcpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBzdHJpcCwgcmVhZE9ubHksIGNhY2hlZE9ubHksIGRpcmVjdG9yeSwgb3BlcmFuZHMgfTtcbn1cblxuLyoqIFRoZSBwYXRjaCB0ZXh0IGF0IGBhYnNvbHV0ZVBhdGhgLCBvciBudWxsIHdoZW4gaXQgY2FuJ3QgYmUgcmVhZC4gKi9cbmZ1bmN0aW9uIHJlYWRQYXRjaEZpbGUoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBFbWl0IHRoZSB3cml0ZSB0b3VjaGVzIGZvciBhIGBwYXRjaGAvYGdpdCBhcHBseWAgY29tbWFuZCB3aXRoIGEgc3RhdGljYWxseVxuICoga25vd24gcGF0Y2gtdGV4dCBzb3VyY2UuIGB0YXJnZXREaXJgIGlzIHdoZXJlIHRoZSBwYXRjaCdzIHRhcmdldCBwYXRoc1xuICogcmVzb2x2ZSAodGhlIGdpdCBgLUNgIGRpcmVjdG9yeSBmb3IgYGdpdCBhcHBseWAsIHRoZSBjdXJyZW50IGRpcmVjdG9yeVxuICogb3RoZXJ3aXNlKTsgYHNoZWxsRGlyYCBpcyB3aGVyZSB0aGUgc2hlbGwncyBzdGRpbiBgPGAgcmVkaXJlY3QgdGFyZ2V0XG4gKiByZXNvbHZlcyBcdTIwMTQgYSByZWRpcmVjdCBpcyBzaGVsbC1zaWRlLCBzbyBgZ2l0IC1DYCBuZXZlciBhZmZlY3RzIGl0LlxuICovXG5mdW5jdGlvbiBlbWl0UGF0Y2hUYXJnZXRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgaXNHaXRBcHBseTogYm9vbGVhbixcbiAgaG9zdDogc3RyaW5nLFxuICB0YXJnZXREaXI6IHN0cmluZyxcbiAgc2hlbGxEaXI6IHN0cmluZyxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuOyAvLyByZWFkLW9ubHkgLyBpbmRleC1vbmx5IFx1MjAxNCBubyB0b3VjaGVzXG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgcGF0Y2hUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIDEuIEEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGdpdCBhcHBseSBvbmx5OyBhIHBhdGNoIG9wZXJhbmQgaXMgYVxuICAvLyAgICB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlIFx1MjAxNCBpZ25vcmVkKS5cbiAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICBjb25zdCBvcGVyYW5kID0gcGFydHMub3BlcmFuZHMuZmluZCgobykgPT4gbyAhPT0gJy0nKTtcbiAgICBpZiAob3BlcmFuZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHRhcmdldERpciwgb3BlcmFuZCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIGZpbGUgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMi4gVGhlIHN0ZGluIGA8YCBzb3VyY2UgKHBhdGNoIGFuZCBnaXQgYXBwbHkpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgY29uc3Qgc3RkaW4gPSByZWRpcmVjdHMuZmluZCgocikgPT4gci5vcCA9PT0gJzwnKTtcbiAgICBpZiAoc3RkaW4gIT09IHVuZGVmaW5lZCAmJiBzdGRpbi50YXJnZXQgIT09IG51bGwpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShzdGRpbi50YXJnZXQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHN0ZGluLnRhcmdldCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHNoZWxsRGlyLCBzdGRpbi50YXJnZXQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCB0ZXh0IHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDMuIE5vIHN0YXRpY2FsbHkga25vd24gc291cmNlOiBzdGRpbiBpcyBkeW5hbWljICh0ZXJtaW5hbCwgcGlwZSwgdmFyaWFibGUpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgaG9zdCwgJ25vIHN0YXRpY2FsbHkga25vd24gcGF0Y2ggdGV4dCBzb3VyY2UgKHN0ZGluIGlzIGR5bmFtaWMpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQsIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UgPz8gaG9zdCwgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIHRhcmdldERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcGF0Y2gvZ2l0IGFwcGx5IGdyYW1tYXIgaW4gdGhlIG1haW4gd2FsazogYHBhdGNoYCByZWFkcyBwYXRjaCB0ZXh0IGZyb21cbiAqIHN0ZGluIG9yIGEgYDxgIHJlZGlyZWN0OyBgZ2l0IGFwcGx5YCBhZGRpdGlvbmFsbHkgYWNjZXB0cyBhIHBhdGNoLWZpbGVcbiAqIG9wZXJhbmQgYW5kIHJlc29sdmVzIHRhcmdldHMgYWdhaW5zdCBpdHMgYC1DYCBkaXJlY3RvcnkuIEEgd3JhcHBlZFxuICogYHBhdGNoYC9gYXBwbHlgIGlzIHVucmVzb2x2ZWQgXHUyMDE0IHRoZSB3cmFwcGVyIG9ic2N1cmVzIHRoZSBhcmd2LlxuICovXG5mdW5jdGlvbiBtYXRjaFBhdGNoQXBwbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKSxcbiAgICAgIGZhbHNlLFxuICAgICAgJ3BhdGNoJyxcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgIHRydWUsXG4gICAgICAnYXBwbHknLFxuICAgICAgc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncGF0Y2gnIHx8IHdyYXBwZWQgPT09ICdhcHBseScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgaGVyZWRvYyBwYXRjaC10ZXh0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KTogYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGhlcmVkb2NcbiAqIGJvZHkgaXMgcGF0Y2ggdGV4dC4gVGhlIG9wZW5lcidzIG93biBvcHRpb25zIHN0aWxsIGFwcGx5IFx1MjAxNCBgLS1kcnktcnVuYC9cbiAqIGAtLWNoZWNrYC9gLS1zdGF0YC9gLS1udW1zdGF0YC9gLS1zdW1tYXJ5YC9gLS1jYWNoZWRgIG1ha2UgdGhlIGJvZHlcbiAqIHJlYWQtb25seSAobm8gdG91Y2hlcyksIGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkLCBhbmQgYC1wTmAgc2V0cyB0aGVcbiAqIGhlYWRlciBzdHJpcCBsZXZlbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlQYXRjaEhlcmVkb2MoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBib2R5OiBzdHJpbmcsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBsZXQgaXNHaXRBcHBseSA9IGZhbHNlO1xuICBsZXQgYXJnczogc3RyaW5nW107XG4gIGxldCBkaXIgPSBjdXJyZW50RGlyO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpc0dpdEFwcGx5ID0gdHJ1ZTtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgZGlyID0gc3ViLmNEaXIgPz8gY3VycmVudERpcjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47XG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShib2R5LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2hlcmVkb2MnLCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmb3JtYXR0ZXIgLyBmaXhlciBncmFtbWFyIChwbGFuIFx1MDBBNzUuOCk6IGEgdGFibGUtZHJpdmVuIGZhbWlseSBvdmVyIHRoZVxuLy8gY29ycHVzLWRlcml2ZWQgMTYtdG9vbCBzZXQuIEZsYWcgbWF0Y2hpbmcgaXMgZXhhY3QtdG9rZW4gb24gZnVsbCBhcmd2IHdvcmRzIFx1MjAxNFxuLy8gbmV2ZXIgcHJlZml4IG9yIHN1YnN0cmluZyBcdTIwMTQgYW5kIHRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QsIHNvXG4vLyBgLS1maXgtZHJ5LXJ1bmAgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBgLS1maXhgIGFuZCBgYmxhY2sgLS1jaGVja2AgbmV2ZXJcbi8vIGhlYWxzLiBUb29scyB3aG9zZSB3cml0ZSBmb3JtIGlzIGEgYmFyZSBpbnZvY2F0aW9uIChibGFjaywgaXNvcnQsIHJ1c3RmbXQpXG4vLyBjYXJyeSB0aGUgZW1wdHkgZm9ybSBhbmQgZmlyZSBvbiB0aGUgd3JpdGUgZm9ybSBpdHNlbGYuIExlYWRpbmcgdHJhbnNwYXJlbnRcbi8vIHBhY2thZ2UtcnVubmVyIHdyYXBwZXJzIChucHgsIHlhcm4sIHBucG0gZXhlYy9kbHgsIGJ1bngsIG5wbSBleGVjKSBzdHJpcFxuLy8gdW5kZXIgYSBwaW5uZWQgb3B0aW9uIGdyYW1tYXI7IGEgd3JhcHBlciB0aGF0IGNvdWxkIHJld3JpdGUgYXJndiBmYWlsc1xuLy8gY2xvc2VkIGFzIHVucmVzb2x2ZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIE9uZSBcdTAwQTc1LjggdGFibGUgcm93OiB0aGUgdG9vbCBjb21tYW5kIGFuZCBpdHMgd3JpdGUvcmVhZC1vbmx5IHRva2VuIGZvcm1zLiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb3JtYXR0ZXJUb29sUm93IHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIHdob3NlIGV4YWN0LXRva2VuIHByZXNlbmNlIG1hcmtzIHRoZSBpbnZvY2F0aW9uIGEgd3JpdGUuICovXG4gIHdyaXRlRm9ybXM6IHN0cmluZ1tdW107XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgY29uc3VsdGVkIGZpcnN0IFx1MjAxNCBwcmVzZW5jZSBzdXBwcmVzc2VzIHRoZSB3cml0ZSAodGhlIHJlYWQtb25seSBtb2RlIHdpbnMpLiAqL1xuICByZWFkT25seUZvcm1zOiBzdHJpbmdbXVtdO1xufVxuXG4vKipcbiAqIFRoZSBcdTAwQTc1LjggdGFibGUsIGV4cG9ydGVkIHNvIHRoZSBjb3JwdXMtY292ZXJhZ2UgZml4dHVyZSBjYW4gYXNzZXJ0IHR3by1zaWRlZFxuICogdG9vbC1zZXQgZXF1YWxpdHkgYW5kIHBlci10b29sIHJlYWQtb25seSBzdXBwcmVzc2lvbiAocGxhbiBcdTAwQTc1LjgsIFBoYXNlIDNcbiAqIHN0ZXAgOCkuXG4gKi9cbmV4cG9ydCBjb25zdCBGT1JNQVRURVJfVEFCTEU6IHJlYWRvbmx5IEZvcm1hdHRlclRvb2xSb3dbXSA9IFtcbiAge1xuICAgIGNvbW1hbmQ6ICdwcmV0dGllcicsXG4gICAgd3JpdGVGb3JtczogW1snLS13cml0ZSddLCBbJy13J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWxpc3QtZGlmZmVyZW50J10sIFsnLS1kZWJ1Zy1jaGVjayddXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdlc2xpbnQnLCB3cml0ZUZvcm1zOiBbWyctLWZpeCddXSwgcmVhZE9ubHlGb3JtczogW1snLS1maXgtZHJ5LXJ1biddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ2Jpb21lJyxcbiAgICB3cml0ZUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0td3JpdGUnXSxcbiAgICAgIFsnY2hlY2snLCAnLS1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0td3JpdGUnXVxuICAgIF0sXG4gICAgcmVhZE9ubHlGb3JtczogW11cbiAgfSxcbiAgeyBjb21tYW5kOiAnZ29mbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWwnXV0gfSxcbiAgeyBjb21tYW5kOiAnZ29pbXBvcnRzJywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtdIH0sXG4gIHsgY29tbWFuZDogJ2NsYW5nLWZvcm1hdCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRyeS1ydW4nXV0gfSxcbiAgeyBjb21tYW5kOiAnc2hmbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXV0gfSxcbiAgeyBjb21tYW5kOiAneWFwZicsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYXV0b3BlcDgnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYmxhY2snLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2lzb3J0Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjay1vbmx5J10sIFsnLS1kaWZmJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAncnVmZicsXG4gICAgd3JpdGVGb3JtczogW1snZm9ybWF0J10sIFsnY2hlY2snLCAnLS1maXgnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLW5vLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS1jaGVjayddXG4gICAgXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdkZW5vJywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydmbXQnLCAnLS1jaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdkcHJpbnQnLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2NoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ3J1c3RmbXQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1lbWl0JywgJ3N0ZG91dCddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3RlcnJhZm9ybScsXG4gICAgd3JpdGVGb3JtczogW1snZm10J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnZm10JywgJy1jaGVjayddLFxuICAgICAgWydmbXQnLCAnLWRpZmYnXVxuICAgIF1cbiAgfVxuXTtcblxuLyoqIFRoZSBwaW5uZWQgcGFja2FnZS1ydW5uZXIgbm8tYXJnIGZsYWdzIChwbGFuIFx1MDBBNzUuOCk6IGZsYWdzIHRoYXQgY2Fubm90IG1vdmUgb3IgcmV3cml0ZSBhcmd2LiAqL1xuY29uc3QgUlVOTkVSX05PX0FSR19GTEFHUyA9IG5ldyBTZXQoWycteScsICctLXllcycsICctLW5vLWluc3RhbGwnXSk7XG5cbi8qKiBUaGUgb3V0Y29tZSBvZiBzdHJpcHBpbmcgb25lIGxlYWRpbmcgcGFja2FnZS1ydW5uZXIgd3JhcHBlci4gKi9cbnR5cGUgUnVubmVyU3RyaXAgPSB7IGtpbmQ6ICdzdHJpcHBlZCc7IHN0cmlwcGVkOiBzdHJpbmdbXSB9IHwgeyBraW5kOiAnb2JzY3VyZWQnIH07XG5cbi8qKlxuICogU3RyaXAgb25lIGxlYWRpbmcgdHJhbnNwYXJlbnQgcGFja2FnZS1ydW5uZXIgd3JhcHBlciAocGxhbiBcdTAwQTc1LjgpOiBgbnB4YCxcbiAqIGB5YXJuYCwgYHBucG0gZXhlY2AvYHBucG0gZGx4YCwgYGJ1bnhgLCBhbmQgYG5wbSBleGVjYCBmb2xsb3dlZCBkaXJlY3RseSBieVxuICogdGhlIHdyYXBwZWQgY29tbWFuZCB3b3JkLCB3aXRoIG9ubHkgdGhlIHBpbm5lZCBuby1hcmcgZmxhZ3MgKGAteWAvYC0teWVzYCxcbiAqIGAtLW5vLWluc3RhbGxgKSBhbmQgYG5wbSBleGVjYCdzIGAtLWAgdGVybWluYXRvciBiZXR3ZWVuLiBBIHN0cmluZy1mb3JtXG4gKiBhcmd1bWVudCAoYG5weCBcInByZXR0aWVyIC0td3JpdGUgZlwiYCksIGFuIGFyZ3YtYWx0ZXJpbmcgcnVubmVyIGZsYWdcbiAqIChgLS1wYWNrYWdlPVhgIG9yIGEgZmxhZyBjb25zdW1pbmcgdGhlIG5leHQgd29yZCksIG9yIGEgd3JhcHBlciB3b3JkIHRoYXQgaXNcbiAqIGl0c2VsZiBhIHNjcmlwdCAoYC5gLXByZWZpeGVkKSBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCB0aGUgd3JhcHBlciBpc1xuICogdHJhbnNwYXJlbnQgb25seSB3aGVuIHRoZSBwaW5uZWQgZ3JhbW1hciBwcm92ZXMgaXQgc28uIFJldHVybnMgJ25vdC1ydW5uZXInXG4gKiB3aGVuIHRoZSB3b3JkIGlzIG5vdCBhIHJ1bm5lciBhdCBhbGwgKGEgZGlmZmVyZW50IG5wbS9wbnBtIHN1YmNvbW1hbmQsIG9yIGFcbiAqIGJhcmUgcnVubmVyIHdpdGggbm8gY29tbWFuZCB3b3JkKSBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHksIHdoaWNoXG4gKiBmYWlscyBjbG9zZWQgZm9yIG5vbi1mb3JtYXR0ZXIgcnVubmVycy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBQYWNrYWdlUnVubmVyKGFyZ3Y6IHN0cmluZ1tdKTogUnVubmVyU3RyaXAgfCAnbm90LXJ1bm5lcicge1xuICBjb25zdCBydW5uZXIgPSBhcmd2WzBdO1xuICBsZXQgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducHgnIHx8IHJ1bm5lciA9PT0gJ3lhcm4nIHx8IHJ1bm5lciA9PT0gJ2J1bngnKSB7XG4gICAgLy8gVGhlc2UgcnVubmVycyB0YWtlIHRoZSBjb21tYW5kIHdvcmQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAncG5wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnICYmIHJlc3RbMF0gIT09ICdkbHgnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ25wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAnbm90LXJ1bm5lcic7XG4gIH1cbiAgd2hpbGUgKFJVTk5FUl9OT19BUkdfRkxBR1MuaGFzKHJlc3RbMF0pKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25wbScgJiYgcmVzdFswXSA9PT0gJy0tJykgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdub3QtcnVubmVyJzsgLy8gYSBiYXJlIHJ1bm5lciBhdHRyaWJ1dGVzIG5vdGhpbmdcbiAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMF07XG4gIGlmICh3cmFwcGVkLnN0YXJ0c1dpdGgoJy0nKSB8fCB3cmFwcGVkLnN0YXJ0c1dpdGgoJy4nKSB8fCAvXFxzLy50ZXN0KHdyYXBwZWQpKSByZXR1cm4geyBraW5kOiAnb2JzY3VyZWQnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdzdHJpcHBlZCcsIHN0cmlwcGVkOiByZXN0IH07XG59XG5cbi8qKlxuICogVGhlIGZvcm1hdHRlci9maXhlciBmYW1pbHkgKHBsYW4gXHUwMEE3NS44KS4gVGhlIHJlYWQtb25seSBmb3JtcyBhcmUgY29uc3VsdGVkXG4gKiBmaXJzdCBhbmQgd2luIG92ZXIgYW55IHdyaXRlIGZvcm07IGEgd3JpdGUgZm9ybSB3aXRoIG5vIHJlYWQtb25seSBmb3JtIGFuZFxuICogZXZlcnkgb3BlcmFuZCBhbiBleHBsaWNpdCBmaWxlIGVtaXRzIGEgd2hvbGUtZmlsZSBgbW9kaWZ5YCBwZXIgb3BlcmFuZDtcbiAqIGRpcmVjdG9yeS9nbG9iL25vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZzsgdW5rbm93biBleGVjdXRhYmxlc1xuICogZmFpbCBjbG9zZWQuIEEgZm9ybSdzIGxlYWRpbmcgc3ViY29tbWFuZCB3b3JkIChgY2hlY2tgL2Bmb3JtYXRgL2BmbXRgKSBpc1xuICogcG9zaXRpb25hbCBcdTIwMTQgaXQgbXVzdCBsZWFkIHRoZSB0b29sJ3MgYXJncywgc28gYGRlbm8gdGFzayBmbXRgIGlzIGEgc2NyaXB0XG4gKiBydW5uZXIsIG5vdCBhIGZvcm1hdHRlci5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hGb3JtYXR0ZXIoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBsZXQgd29yZHMgPSByZXN0O1xuICBjb25zdCBzdHJpcCA9IHN0cmlwUGFja2FnZVJ1bm5lcihyZXN0KTtcbiAgaWYgKHN0cmlwID09PSAnbm90LXJ1bm5lcicpIHtcbiAgICAvLyByZXN0WzBdIGlzIG5vdCBhIHBhY2thZ2UgcnVubmVyIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChzdHJpcC5raW5kID09PSAnb2JzY3VyZWQnKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHJlc3RbMF0sIGB0aGUgJHtyZXN0WzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3ZgKTtcbiAgICByZXR1cm47XG4gIH0gZWxzZSB7XG4gICAgd29yZHMgPSBzdHJpcC5zdHJpcHBlZDtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMod29yZHNbMF0pKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHdvcmRzWzFdO1xuICAgIGlmICh3cmFwcGVkICE9PSB1bmRlZmluZWQgJiYgRk9STUFUVEVSX1RBQkxFLnNvbWUoKHIpID0+IHIuY29tbWFuZCA9PT0gd3JhcHBlZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7d29yZHNbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93ID0gRk9STUFUVEVSX1RBQkxFLmZpbmQoKHIpID0+IHIuY29tbWFuZCA9PT0gd29yZHNbMF0pO1xuICBpZiAocm93ID09PSB1bmRlZmluZWQpIHJldHVybjsgLy8gdW5rbm93biBleGVjdXRhYmxlIFx1MjAxNCBmYWlsIGNsb3NlZCwgbm8gdG91Y2hcbiAgY29uc3QgYXJncyA9IHdvcmRzLnNsaWNlKDEpO1xuICBjb25zdCBmb3JtUHJlc2VudCA9IChmb3JtOiBzdHJpbmdbXSk6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGZpcnN0ID0gZm9ybVswXTtcbiAgICBpZiAoZmlyc3QgIT09IHVuZGVmaW5lZCAmJiAhZmlyc3Quc3RhcnRzV2l0aCgnLScpICYmIGFyZ3NbMF0gIT09IGZpcnN0KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGZvcm0uZXZlcnkoKHRva2VuKSA9PiBhcmdzLmluY2x1ZGVzKHRva2VuKSk7XG4gIH07XG4gIC8vIFRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QgYW5kIHdpbnMgb3ZlciBhbnkgd3JpdGUgZm9ybTpcbiAgLy8gYGVzbGludCAtLWZpeCAtLWZpeC1kcnktcnVuIGZgIHdyaXRlcyBub3RoaW5nLCBgYmxhY2sgLS1jaGVjayBmYCBuZXZlciBoZWFscy5cbiAgaWYgKHJvdy5yZWFkT25seUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47XG4gIGlmICghcm93LndyaXRlRm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjsgLy8gYmFyZSBpbnZvY2F0aW9ucyBvZiBmbGFnLXJlcXVpcmVkIHRvb2xzIGFyZSByZWFkLW9ubHkgKHN0ZG91dC9saW50KVxuICAvLyBDb25zdW1lIHRoZSB0b29sJ3Mgc3ViY29tbWFuZCB3b3JkIGJlZm9yZSBjb2xsZWN0aW5nIG9wZXJhbmRzLlxuICBjb25zdCBzdWJjb21tYW5kV29yZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmb3JtIG9mIHJvdy53cml0ZUZvcm1zKSB7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiBmb3JtKSB7XG4gICAgICBpZiAoIXRva2VuLnN0YXJ0c1dpdGgoJy0nKSkgc3ViY29tbWFuZFdvcmRzLmFkZCh0b2tlbik7XG4gICAgfVxuICB9XG4gIGNvbnN0IGFmdGVyU3ViY29tbWFuZCA9IHN1YmNvbW1hbmRXb3Jkcy5oYXMoYXJnc1swXSkgPyBhcmdzLnNsaWNlKDEpIDogYXJncztcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhZnRlclN1YmNvbW1hbmQpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChzaGFyZWQgXHUwMEE3NSlcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChvcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjsgLy8gbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nXG4gIC8vIEV2ZXJ5IG9wZXJhbmQgbXVzdCBiZSBhbiBleHBsaWNpdCBmaWxlIFx1MjAxNCBhIGdsb2IsIHZhcmlhYmxlLCBkaXJlY3RvcnksIG9yXG4gIC8vIHRyYWlsaW5nLXNsYXNoIG9wZXJhbmQgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkLlxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpKSkgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ2Zvcm1hdHRlci13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpLCB0aGUgbGFzdCBwdXJlLXBhcnNlclxuLy8gZmFtaWx5LiBSZXN0b3JlIGhhcyBubyByZXZpc2lvbiBvcGVyYW5kIGZvcm0gXHUyMDE0IGl0cyBwb3NpdGlvbmFsIGFyZ3MgYXJlXG4vLyBhbHdheXMgcGF0aHNwZWNzOyBjaGVja291dCBza2lwcyBhIHByZS1gLS1gIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCB0YWtlc1xuLy8gcGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC4gRXZlcnkgZXhwbGljaXQtZmlsZSBwYXRoc3BlYyBpcyBhIHdob2xlLWZpbGVcbi8vIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyAoYC5gL2AuLmAsIHRyYWlsaW5nIGAvYCxcbi8vIG9yIGEgcGF0aCB0aGF0IHN0YXRzIGFzIGEgZGlyZWN0b3J5KSwgYC0tc3RhZ2VkYC1vbmx5IHJlc3RvcmUsIGFuZFxuLy8gYC1wYC9gLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gYWxsIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBnaXQgcmVzdG9yZSBuby12YWx1ZSBmbGFncyAocGxhbiBcdTAwQTc1LjkpOyBgLXNgL2AtLXNvdXJjZWAsIGAtLXN0YWdlZGAsIGAtV2AvYC0td29ya3RyZWVgLCBgLW1gL2AtLW1lcmdlYCwgYW5kIGAtcGAvYC0tcGF0Y2hgIGFyZSBoYW5kbGVkIGV4cGxpY2l0bHkuICovXG5jb25zdCBSRVNUT1JFX05PX1ZBTFVFID0gbmV3IFNldChbJy1xJywgJy1mJywgJy11J10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlYyBlbWlzc2lvbiAocGxhbiBcdTAwQTc1LjkpOiBhbiBleHBsaWNpdC1maWxlXG4gKiBwYXRoc3BlYyAobm8gZ2xvYnMsIG5vIGAuYC9gLi5gLCBubyBkaXJlY3RvcnksIG5vIHRyYWlsaW5nIGAvYCkgaXMgYVxuICogY3JlYXRlLW92ZXJ3cml0ZSB3aG9sZS1maWxlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgaXNcbiAqIHVucmVzb2x2ZWQgXHUyMDE0IGEgZGlyZWN0b3J5IHJlc3RvcmUvY2hlY2tvdXQgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGhcbiAqIGl0IGFuZCBjYW5ub3QgYmUgYXR0cmlidXRlZCB0byBhIGZpbGUgd3JpdGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhcbiAgcmVzdWx0czogU3Bhbk1hdGNoW10sXG4gIGlkaW9tOiAnZ2l0LXJlc3RvcmUtd3JpdGUnIHwgJ2dpdC1jaGVja291dC13cml0ZScsXG4gIG9wZXJhbmQ6IHN0cmluZyxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuKTogdm9pZCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIGlkaW9tLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKTtcbiAgaWYgKG9wZXJhbmQgPT09ICcuJyB8fCBvcGVyYW5kID09PSAnLi4nIHx8IG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgIHJlc3VsdHMsXG4gICAgICBpZGlvbSxcbiAgICAgIG9wZXJhbmQsXG4gICAgICAnZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aCBpdCBcdTIwMTQgbm90IGF0dHJpYnV0YWJsZSB0byBhIGZpbGUgd3JpdGUnXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb20sXG4gICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtc2AvYC0tc291cmNlPTx0cmVlPmAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIHRyZWUgb3BlcmFuZCBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL2AtLXBhdGNoYFxuICogaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYC1tYC9gLS1tZXJnZWAgKHRoZSBtZXJnZVxuICogbWFjaGluZXJ5LCBjb25kaXRpb25hbCBvbiB0aGUgaW5kZXggYmVpbmcgdW5tZXJnZWQpIGFuZCBgLS1zdGFnZWRgIHdpdGhvdXRcbiAqIGAtLXdvcmt0cmVlYCAoaW5kZXgtb25seSBcdTIwMTQgdGhlIHdvcmtpbmcgZmlsZSBzdXJ2aXZlcykgdG91Y2ggbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZXN0b3JlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzdGFnZWQgPSBmYWxzZTtcbiAgbGV0IHdvcmt0cmVlID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1yZXN0b3JlLXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1zJyB8fCBhID09PSAnLS1zb3VyY2UnKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSB0cmVlIG9wZXJhbmQgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tc291cmNlPScpKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1tJyB8fCBhID09PSAnLS1tZXJnZScpIHJldHVybjtcbiAgICBpZiAoYSA9PT0gJy0tc3RhZ2VkJykge1xuICAgICAgc3RhZ2VkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1XJyB8fCBhID09PSAnLS13b3JrdHJlZScpIHtcbiAgICAgIHdvcmt0cmVlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoUkVTVE9SRV9OT19WQUxVRS5oYXMoYSkpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAoc3RhZ2VkICYmICF3b3JrdHJlZSkgcmV0dXJuOyAvLyBpbmRleC1vbmx5IHJlc3RvcmUgZG9lcyBub3QgdG91Y2ggdGhlIHdvcmtpbmcgZmlsZVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1yZXN0b3JlLXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCBjaGVja291dCBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1iYC9gLUJgL2AtLW9ycGhhbiA8YnJhbmNoPmBcbiAqIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBicmFuY2ggbmFtZSBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL1xuICogYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGEgcHJlLWAtLWAgcG9zaXRpb25hbCBpc1xuICogYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgaXMgc2tpcHBlZC4gUGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hDaGVja291dE9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLWInIHx8IGEgPT09ICctQicgfHwgYSA9PT0gJy0tb3JwaGFuJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgYnJhbmNoIG5hbWUgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctcScgfHwgYSA9PT0gJy1tJyB8fCBhID09PSAnLXQnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIC8vIEEgcHJlLWAtLWAgcG9zaXRpb25hbCBpcyBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIFx1MjAxNCBuZXZlciBhIHBhdGhzcGVjLlxuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LWNoZWNrb3V0LXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGZhbWlseSAocGxhbiBcdTAwQTc1LjkpOiB2aWEgYGZpbmRHaXRTdWJjb21tYW5kYFxuICogKGhhbmRsZXMgYGdpdCAtQ2AvYC1jYCksIHRoZSB0d28gc3ViY29tbWFuZHMgcmVzb2x2ZSB0aGVpciBwYXRoc3BlY3MgdG9cbiAqIHdob2xlLWZpbGUgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBhIHdyYXBwZWQgc3ViY29tbWFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgKHN1Yi5zdWJjb21tYW5kICE9PSAncmVzdG9yZScgJiYgc3ViLnN1YmNvbW1hbmQgIT09ICdjaGVja291dCcpKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQsXG4gICAgICAgICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIGNvbnN0IGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJykgbWF0Y2hSZXN0b3JlT3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIGVsc2UgbWF0Y2hDaGVja291dE9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdyZXN0b3JlJyB8fCB3cmFwcGVkID09PSAnY2hlY2tvdXQnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICB3cmFwcGVkLFxuICAgICAgICBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG4vKipcbiAqIFNwYW4tbGVzcyBjb21tYW5kcyB3aG9zZSBleGl0IHN0YXR1cyBpcyBkZXRlcm1pbmlzdGljIFx1MjAxNCB1c2FibGUgYXMgZ3VhcmRzIGluXG4gKiBgJiZgL2B8fGAgam9pbnMgKHBsYW4gXHUwMEE3MyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmQgcnVsZSk6IGBmYWxzZWAgYWx3YXlzXG4gKiBleGl0cyAxLCBgdHJ1ZWAgYW5kIGA6YCBhbHdheXMgMCwgc28gYSBmb2xsb3dpbmcgam9pbmVkIGNvbW1hbmQncyBza2lwIGlzXG4gKiBrbm93YWJsZSBldmVuIHRob3VnaCBuZWl0aGVyIHByb2R1Y2VzIGEgc3Bhbi5cbiAqL1xuY29uc3QgQlVJTFRJTl9HVUFSRF9TVEFUVVMgPSBuZXcgTWFwPHN0cmluZywgMCB8IDE+KFtcbiAgWydmYWxzZScsIDFdLFxuICBbJ3RydWUnLCAwXSxcbiAgWyc6JywgMF1cbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBvcHRzOiBzdHJpbmcgfCBQYXJzZU9wdGlvbnMgPSB7fSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgY3dkID0gdHlwZW9mIG9wdHMgPT09ICdzdHJpbmcnID8gb3B0cyA6IChvcHRzLmN3ZCA/PyBwcm9jZXNzLmN3ZCgpKTtcblxuICBjb25zdCB7IHdyaXRlczogaGVyZWRvY1dyaXRlcywgbWFza2VkIH0gPSBleHRyYWN0SGVyZWRvY1dyaXRlcyhjb21tYW5kKTtcbiAgY29uc3QgeyBzdGFnZXM6IHNpbXBsZUNvbW1hbmRzLCBtYWxmb3JtZWQgfSA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICAvLyBWZXJkaWN0IGNvbnN1bXB0aW9uIChwbGFuIFx1MDBBNzEsIGxpc3Qtc2NvcGUgKyB0ZXJtaW5hbCBzZW1hbnRpY3MpOiB0aGVcbiAgLy8gc3BsaXR0ZXIgaGFzIGFscmVhZHkgZHJvcHBlZCB0aGUgcmVqZWN0aW5nIGxpc3QncyBzdGFnZXMgYW5kIHRydW5jYXRlZCBhdFxuICAvLyB0aGUgZmlyc3QgbWFsZm9ybWVkIGxpc3QsIHNvIGBzaW1wbGVDb21tYW5kc2AgaXMgZXhhY3RseSB0aGUgY29tcGxldGVkXG4gIC8vIGVhcmxpZXIgbGlzdHMgYW5kIHdhbGtzIG5vcm1hbGx5IGJlbG93IFx1MjAxNCB0aGUgZnVsbC1saW5lIGtpbmRzXG4gIC8vICgndW5jbG9zZWQtcXVvdGUnLCAndW5iYWxhbmNlZC1wYXJlbicsICdkYW5nbGluZy1vcGVyYXRvcicsICdwaXBlLWJhbmcnLFxuICAvLyAndW5jbG9zZWQtYnJhY2UnLCAndW5jbG9zZWQtY2FzZScsICd1bmNsb3NlZC1jb25zdHJ1Y3QnKSBlbWl0IG5vIHRvdWNoZXNcbiAgLy8gd2l0aG91dCBmdXJ0aGVyIGhhbmRsaW5nLiAndW50ZXJtaW5hdGVkLWhlcmVkb2MnICh0aGUgcGFydGlhbCwgYXJyaXZpbmdcbiAgLy8gd2l0aCB0aGUgaGVyZWRvYyBtYWNoaW5lcnkgaW4gYSBsYXRlciBwaGFzZSkga2VlcHMgdGhlIGN1cnJlbnQgYmVoYXZpb3I6XG4gIC8vIGl0cyBzdGFnZSBsaXN0IHJ1bnMgdGhyb3VnaCB0aGUgZGVsaW1pdGVyJ3MgbGluZSBhbmQgbGlrZXdpc2UgYW5hbHl6ZXNcbiAgLy8gYXMtaXMuXG4gIHZvaWQgbWFsZm9ybWVkO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XFx1MDAwMCR7cmV2fVxcdTAwMDAke3BhdGh9YDtcbiAgICBpZiAoIWdpdExpbmVDYWNoZS5oYXMoa2V5KSkgZ2l0TGluZUNhY2hlLnNldChrZXksIGNvdW50R2l0QmxvYkxpbmVzKGdpdEN3ZCwgcmV2LCBwYXRoKSk7XG4gICAgcmV0dXJuIGdpdExpbmVDYWNoZS5nZXQoa2V5KSA/PyBudWxsO1xuICB9O1xuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgbGFzdFBsYWluRmlsZVNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIFRoZSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKHBsYW4gXHUwMEE3NS4yKTogc2V0IGF0IHRoZSBlbmQgb2ZcbiAgLy8gZWFjaCBzaW1wbGUgY29tbWFuZCwgY2xlYXJlZCBhdCBhbnkgbm9uLXBpcGUgYm91bmRhcnksIHRocmVhZGVkIGJ5IHRlZSAtYVxuICAvLyBhcHBlbmRzIGluIHRoZSBuZXh0IHBpcGUgc3RhZ2UgKGBlY2hvIHggfCB0ZWUgLWEgZmApLlxuICBsZXQgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAvKiogVGhlIGBqb2luYCBzdGFtcCBmb3IgYSBzaW1wbGUgY29tbWFuZDogb25seSB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBjb25zdCBqb2luT2YgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kKTogUmVzb2x2ZWRTcGFuWydqb2luJ10gPT4ge1xuICAgIGlmIChzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ2FuZCcpIHJldHVybiAnJiYnO1xuICAgIGlmIChzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ29yJykgcmV0dXJuICd8fCc7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfTtcblxuICAvKiogVGhlIHBhcnRzIG9mIGEgZnJhbWUgdGhlIHJlc29sdXRpb24gcGF0aHMgbmVlZCAobm8gT0xEUFdEKS4gKi9cbiAgaW50ZXJmYWNlIEZyYW1lIHtcbiAgICBkaXI6IHN0cmluZztcbiAgICBjZXJ0YWluOiBib29sZWFuO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBlZmZlY3RpdmUgZ2l0IHJlcG8gZGlyIGZvciBhIGNhbmRpZGF0ZSAocGxhbiBcdTAwQTc2KTogYW4gYWJzb2x1dGUgYC1DYFxuICAgKiB0YXJnZXQgaXMgc2VsZi1jb250YWluZWQ7IGEgcmVsYXRpdmUgb25lIGNvbXBvc2VzIHdpdGggdGhlIHRyYWNrZWRcbiAgICogZGlyZWN0b3J5OyBubyBgLUNgIHVzZXMgdGhlIHRyYWNrZWQgZGlyZWN0b3J5IGl0c2VsZi4gVW5kZWZpbmVkIHdoZW4gdGhlXG4gICAqIGZyYW1lIGlzIHVuY2VydGFpbiBcdTIwMTQgdGhlIHJlcG8gbG9jYXRpb24gaXMgdW5rbm93biwgZmFpbCBjbG9zZWQuXG4gICAqL1xuICBjb25zdCBnaXREaXJPZiA9IChjOiB7IGRpck92ZXJyaWRlPzogc3RyaW5nIH0sIGZyYW1lOiBGcmFtZSk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgaWYgKGMuZGlyT3ZlcnJpZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyYW1lLmNlcnRhaW4gPyBmcmFtZS5kaXIgOiB1bmRlZmluZWQ7XG4gICAgaWYgKGlzQWJzb2x1dGUoYy5kaXJPdmVycmlkZSkpIHJldHVybiBjLmRpck92ZXJyaWRlO1xuICAgIHJldHVybiBmcmFtZS5jZXJ0YWluID8gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBjLmRpck92ZXJyaWRlKSA6IHVuZGVmaW5lZDtcbiAgfTtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKGM6IFJhd0NhbmRpZGF0ZSwgZnJhbWU6IEZyYW1lLCBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlciwgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10pID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFBsYW4gXHUwMEE3NiBjZXJ0YWludHk6IGEgcmVsYXRpdmUgcGF0aCBhZ2FpbnN0IGFuIHVuY2VydGFpbiBkaXJlY3RvcnksIG9yIGFcbiAgICAvLyBnaXQgY2FuZGlkYXRlIHdob3NlIHJlcG8gZnJhbWUgY2Fubm90IGJlIGNvbXBvc2VkLCBpcyB1bnJlc29sdmFibGUgXHUyMDE0XG4gICAgLy8gbmV2ZXIgYSBndWVzc2VkIHRvdWNoLiBBYnNvbHV0ZSBwYXRocyBhcmUgdW5hZmZlY3RlZC5cbiAgICBpZiAoYy5yZXNvbHZlcktpbmQgPT09ICdmcycpIHtcbiAgICAgIGlmICghZnJhbWUuY2VydGFpbiAmJiAhaXNBYnNvbHV0ZShjLmZpbGVBcmcpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICAgIHJlYXNvbjogJ3RoZSB3b3JraW5nIGRpcmVjdG9yeSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZWxhdGl2ZSBwYXRoIGNhbm5vdCBiZSByZXNvbHZlZCdcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGdpdERpck9mKGMsIGZyYW1lKSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAndGhlIGdpdCAtQyB0YXJnZXQgY2Fubm90IGJlIHJlc29sdmVkIGFnYWluc3QgdGhlIHRyYWNrZWQgZGlyZWN0b3J5J1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIEEgZ2l0IGNhbmRpZGF0ZSdzIHBhdGggcmVzb2x2ZXMgaW5zaWRlIGl0cyByZXBvIGRpciAoYC1DYCB0YXJnZXQgb3IgdGhlXG4gICAgLy8gdHJhY2tlZCBkaXJlY3RvcnkpLCBub3QgdGhlIHByb2Nlc3MgZGlyIFx1MjAxNCBwbGFuIFx1MDBBNzYuXG4gICAgY29uc3QgcmVzb2x1dGlvbkRpciA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGMuZGlyT3ZlcnJpZGUgPT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gZnJhbWUuZGlyXG4gICAgICAgICAgOiBpc0Fic29sdXRlKGMuZGlyT3ZlcnJpZGUpXG4gICAgICAgICAgICA/IGMuZGlyT3ZlcnJpZGVcbiAgICAgICAgICAgIDogcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBjLmRpck92ZXJyaWRlKVxuICAgICAgICA6IGdpdERpck9mKGMsIGZyYW1lKSE7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgocmVzb2x1dGlvbkRpciwgYy5maWxlQXJnKTtcbiAgICBjb25zdCB0b3RhbExpbmVzID1cbiAgICAgIGMucmVzb2x2ZXJLaW5kID09PSAnZnMnXG4gICAgICAgID8gY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aClcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKHJlc29sdXRpb25EaXIsIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW5cbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvKipcbiAgICogVGhlIHJlYWQgaWRpb21zIGZvciBvbmUgc2ltcGxlIGNvbW1hbmQgKHRoZSBleGlzdGluZyBjb3JwdXMgZ3JhbW1hcik6XG4gICAqIHBsYWluIGBjYXRgL2BubGAgc291cmNlcywgdGhlIGxpbmUgc2VsZWN0b3JzLCBhbmQgdGhlIGdpdCBtYXRjaGVycywgd2l0aFxuICAgKiBvbmUtaG9wIHBpcGUtc291cmNlIHByb3BhZ2F0aW9uIGZvciBkb3duc3RyZWFtIGBoZWFkYC9gdGFpbGAvYHNlZCAtbmAuXG4gICAqL1xuICBjb25zdCBtYXRjaFJlYWRzID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10sIGk6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGxldCBpc1BsYWluU291cmNlID0gZmFsc2U7XG4gICAgbGV0IHBsYWluRmlsZUFyZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnICYmIGFyZ3YubGVuZ3RoID09PSAyICYmICFhcmd2WzFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBwbGFpbkZpbGVBcmcgPSBhcmd2WzFdO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGFyZ3ZbMV0pID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGFyZ3ZbMV0pO1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ25sJyAmJiBhcmd2Lmxlbmd0aCA+PSAyICYmICFhcmd2W2FyZ3YubGVuZ3RoIC0gMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IGYgPSBhcmd2W2FyZ3YubGVuZ3RoIC0gMV07XG4gICAgICBwbGFpbkZpbGVBcmcgPSBmO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGYpID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGYpO1xuICAgIH1cblxuICAgIC8vIEEgYmFyZSBgY2F0IGZpbGVgL2BubCBmaWxlYCB0aGF0IGlzIG5vdCBmZWVkaW5nIGEgZG93bnN0cmVhbSBwaXBlIHN0YWdlXG4gICAgLy8gcmVhZHMgdGhlIHdob2xlIGZpbGU6IGVtaXQgdGhlIHNhbWUgd2hvbGUtZmlsZSBzcGFuIGBnaXQgc2hvdyByZXY6cGF0aGBcbiAgICAvLyBwcm9kdWNlcy4gV2hlbiBhIHBpcGUgZm9sbG93cywgdGhlIGRvd25zdHJlYW0gbGluZS1zZWxlY3RvciBhbHJlYWR5XG4gICAgLy8gZW1pdHMgdGhlIHByZWNpc2UgcmFuZ2UsIHNvIHRoZSBzb3VyY2Ugc3RheXMgc291cmNlLW9ubHkuXG4gICAgaWYgKHBsYWluRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbmV4dCA9IHNpbXBsZUNvbW1hbmRzW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dC5wcmVjZWRlZEJ5ICE9PSAncGlwZScpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICAgIGlkaW9tOiBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZScsXG4gICAgICAgICAgICBmaWxlQXJnOiBwbGFpbkZpbGVBcmcsXG4gICAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICAgICAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgZGlyOiBjdXJyZW50RGlyLCBjZXJ0YWluOiB0cnVlIH0sXG4gICAgICAgICAgaSxcbiAgICAgICAgICBqb2luT2Yoc2ltcGxlKVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIFsuLi5MSU5FX1NFTEVDVE9SUywgbWF0Y2hHaXRTaG93LCBtYXRjaEdpdExvZ0xdKSB7XG4gICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcihhcmd2KSkge1xuICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW1pdENhbmRpZGF0ZShvdXRjb21lLCB7IGRpcjogY3VycmVudERpciwgY2VydGFpbjogdHJ1ZSB9LCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAncGlwZScgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpXG4gICAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIHsgZGlyOiBjdXJyZW50RGlyLCBjZXJ0YWluOiB0cnVlIH0sIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5Tb3VyY2UpIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICB9O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ29tbWFuZHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBzaW1wbGVDb21tYW5kc1tpXTtcblxuICAgIC8vIEEgcGlwZSBzdGFnZSBtYXkgaW5oZXJpdCB0aGUgcHJldmlvdXMgc3RhZ2UncyBsaXRlcmFsIGVjaG8gY29udGVudDsgYW55XG4gICAgLy8gb3RoZXIgYm91bmRhcnkgY2xlYXJzIGl0LlxuICAgIGlmIChzaW1wbGUucHJlY2VkZWRCeSAhPT0gJ3BpcGUnKSBwaXBlRWNob0NvbnRlbnQgPSBudWxsO1xuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IHNpbXBsZS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICBjb25zdCB3ID0gaGVyZWRvY1dyaXRlc1tOdW1iZXIucGFyc2VJbnQoaGVyZWRvY1JlZlsxXSwgMTApXTtcbiAgICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHcub3BlbmVyKS50cmltKCkpO1xuICAgICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBvcGVuZXJBcmd2ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpLmFyZ3Y7XG4gICAgICBtYXRjaFJlYWRzKHNpbXBsZSwgb3BlbmVyQXJndiwgaSk7XG4gICAgICBjbGFzc2lmeUhlcmVkb2NPcGVuZXIody5vcGVuZXIsIHcuYm9keSwgdy5xdW90ZWREZWxpbSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQob3BlbmVyQXJndikgPz8gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZS50ZXh0KS50cmltKCkpO1xuICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gICAgaWYgKGFyZ3YubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBCYXJlIGA+IGZgIC8gYDogPiBmYDogbm8gYXJndiwgYnV0IHRoZSB0cnVuY2F0aW9uIGdyYW1tYXIgc3RpbGwgZmlyZXMuXG4gICAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBiZWZvcmUgPSByZXN1bHRzLmxlbmd0aDtcbiAgICBtYXRjaFJlYWRzKHNpbXBsZSwgYXJndiwgaSk7XG4gICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoQ29weU1vdmVGYW1pbHkoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUm1UcnVuY2F0ZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hTZWRJbnBsYWNlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFBhdGNoQXBwbHkoYXJndiwgcmVkaXJlY3RzLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hGb3JtYXR0ZXIoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT09IGJlZm9yZSkge1xuICAgICAgLy8gTm8gc3BhbiBmb3IgdGhpcyBjb21tYW5kOiBhIGRldGVybWluaXN0aWMgYnVpbHRpbiBpcyBzdGlsbCBhIHVzYWJsZVxuICAgICAgLy8gam9pbiBndWFyZCAoYGZhbHNlICYmIGVjaG8geCA+IGZgIG11c3Qgc2tpcCB0aGUgZWNobykuIEFueSBvdGhlclxuICAgICAgLy8gY29tbWFuZCBzdGF5cyBzcGFuLWxlc3MgYW5kIHVua25vd2FibGUgXHUyMDE0IHRoZSBkcml2ZXIgZmFpbHMgb3Blbi5cbiAgICAgIGNvbnN0IHN0YXR1cyA9IEJVSUxUSU5fR1VBUkRfU1RBVFVTLmdldChhcmd2WzBdKTtcbiAgICAgIGlmIChzdGF0dXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleDogaSxcbiAgICAgICAgICBqb2luOiBqb2luT2Yoc2ltcGxlKSxcbiAgICAgICAgICBleGl0U3RhdHVzOiBzdGF0dXNcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KGFyZ3YpID8/IG51bGw7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqIFBhcnNlcyBhIEJhc2ggYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlK2xpbmUtcmFuZ2Ugc3BhbnMgaXQgc3RhdGljYWxseSwgcmVsaWFibHkgcmVhZHMgb3Igd3JpdGVzLiBgY3dkYCBkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWAgXHUyMDE0IHBhc3MgdGhlIGhvb2sncyBvd24gYGN3ZGAgZmllbGQgKHRoZSBzdHJpbmcgc2hvcnRoYW5kLCBvciBgb3B0cy5jd2RgKSBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgb3B0czogc3RyaW5nIHwgUGFyc2VPcHRpb25zID0ge30pOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgb3B0cyk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqXG4gKiBUaGUgd29yZC1sZXZlbCB0b2tlbml6ZXIgKFt0b2tlbml6ZV0pIGlzIHF1b3RlLSBhbmQgcmVkaXJlY3QtYXdhcmUgKHBsYW5cbiAqIFx1MDBBNzUuMTApOiByZWRpcmVjdCBvcGVyYXRvcnMgYXJlIHNwbGl0IGFzIGRpc3RpbmN0IHRva2VucyB3aXRoIGF0dGFjaGVkLXRhcmdldFxuICogZm9ybXMgcHJlc2VydmVkIChgPmZgKSwgcXVvdGVkIHRva2VucyBhcmUgd29yZHMgYW5kIG5ldmVyIG9wZXJhdG9ycywgYW5kXG4gKiBbYXJndk9mXSBkZXJpdmVzIG9wZXJhbmRzIGZyb20gdGhlIHRva2VuIHN0cmVhbSBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kXG4gKiB0aGVpciB0YXJnZXRzLlxuICovXG5cbi8qKlxuICogVGhlIG5vcm1hbGl6ZWQgYm91bmRhcnkgb3BlcmF0b3JzIGBzcGxpdFRvcExldmVsYCBlbWl0cyBcdTIwMTQgdGhlIHNpbmdsZVxuICogcmVwcmVzZW50YXRpb24gYm90aCBhZGFwdGVycyBjb25zdW1lLlxuICovXG5leHBvcnQgdHlwZSBPcGVyYXRvciA9ICdwaXBlJyB8ICdhbmQnIHwgJ29yJyB8ICdzZW1pY29sb24nIHwgJ25ld2xpbmUnIHwgJ2JhY2tncm91bmQnIHwgJ3N0YXJ0JztcblxuLyoqIE9uZSBgc2ltcGxlIGNvbW1hbmRgIGZvdW5kIGluIGEgbGFyZ2VyIHNjcmlwdCwgcGx1cyB3aGljaCBvcGVyYXRvciBwcmVjZWRlZCBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2ltcGxlQ29tbWFuZCB7XG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBvcGVyYXRvciBpbW1lZGlhdGVseSBiZWZvcmUgdGhpcyBjb21tYW5kOiAncGlwZScgZm9yIGEgcGlwZWxpbmVcbiAgICogc3RhZ2UsICdhbmQnIGZvciBgJiZgIC8gJ29yJyBmb3IgYHx8YCAodGhlIG9ubHkgb3BlcmF0b3JzIHRoYXQgZ2F0ZSwgcGxhblxuICAgKiBcdTAwQTczIHN0ZXAgMiksICdzZW1pY29sb24nIGZvciBgO2AsICduZXdsaW5lJyBmb3IgYSBuZXdsaW5lIHNlcGFyYXRvcixcbiAgICogJ2JhY2tncm91bmQnIGZvciBgJmAsIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kLlxuICAgKi9cbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgc3RhZ2UncyBzdGRpbiBpcyBmZWQgYnkgYSBgPDxgL2A8PC1gIGhlcmVkb2MgYm9keS4gVGhlXG4gICAqIG9wZXJhdG9yK2RlbGltaXRlciBhcmUgc3RyaXBwZWQgZnJvbSBgdGV4dGAgKHRoZSBzdGFnZSBrZWVwcyBhIHBsYWluXG4gICAqIGFyZ3YpLCBzbyBhIGNvbnN1bWVyIHRoYXQgc2NhbnMgZm9yIGFuIHVucXVvdGVkIGA8YCBhcyBhIHN0ZGluIHJlZGlyZWN0XG4gICAqIGNhbm5vdCBzZWUgdGhlIGhlcmVkb2MgaW4gdGhlIHRleHQgXHUyMDE0IHRoaXMgZmxhZyBzdXJmYWNlcyBpdC5cbiAgICovXG4gIGhlcmVkb2M/OiBib29sZWFuO1xufVxuXG4vKiogVGhlIHZlcmRpY3Qga2luZHMgYHNwbGl0VG9wTGV2ZWxgIGNhbiByZXR1cm4gd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yIChwbGFuIFx1MDBBNzEpLiAqL1xuZXhwb3J0IHR5cGUgTWFsZm9ybWVkVmVyZGljdCA9XG4gIHwgJ3VuY2xvc2VkLXF1b3RlJ1xuICB8ICd1bmJhbGFuY2VkLXBhcmVuJ1xuICB8ICdkYW5nbGluZy1vcGVyYXRvcidcbiAgfCAncGlwZS1iYW5nJ1xuICB8ICd1bnRlcm1pbmF0ZWQtaGVyZWRvYydcbiAgfCAndW5jbG9zZWQtYnJhY2UnXG4gIHwgJ3VuY2xvc2VkLWNhc2UnXG4gIHwgJ3VuY2xvc2VkLWNvbnN0cnVjdCc7XG5cbi8qKiBUaGUgcmVzdWx0IG9mIGEgdG9wLWxldmVsIHNwbGl0OiB0aGUgc3RhZ2UgbGlzdCwgcGx1cyBhIGBtYWxmb3JtZWRgIHZlcmRpY3Qgd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGxpdFJlc3VsdCB7XG4gIHN0YWdlczogU2ltcGxlQ29tbWFuZFtdO1xuICAvKipcbiAgICogU2V0IHdoZW4gdGhlIGlucHV0IGlzIGEgQmFzaCBwYXJzZSBlcnJvciBcdTIwMTQgYmFzaCByZWplY3RzIHRoZSBlbnRpcmUgbGlzdCBhdFxuICAgKiBwYXJzZSB0aW1lIChleGl0IDIsIG5vdGhpbmcgZXhlY3V0ZWQpLCBzbyBhbnkgc3RhZ2UtZGVyaXZlZCB0b3VjaCB3b3VsZCBiZVxuICAgKiBhIHBoYW50b20uIFRoZSByZWplY3Rpb24gaXMgbGlzdC1zY29wZWQgYW5kIHRlcm1pbmFsIChwbGFuIFx1MDBBNzEpOiB0aGUgc3RhZ2VcbiAgICogbGlzdCBrZWVwcyBldmVyeSBzdGFnZSBmcm9tIGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzLCBkcm9wcyB0aGUgcmVqZWN0aW5nXG4gICAqIGxpc3QncyBvd24gc3RhZ2VzLCBhbmQgc3RvcHMgYXQgaXQgXHUyMDE0IGV2ZXJ5IGxhdGVyIHVuaXQgaXMgZGVhZC5cbiAgICovXG4gIG1hbGZvcm1lZD86IE1hbGZvcm1lZFZlcmRpY3Q7XG59XG5cbi8qKiBUaGUgY29uc3RydWN0IGtpbmRzIHRoZSBraW5kLW1hdGNoZWQgc3RhY2sgdHJhY2tzIChwbGFuIFx1MDBBNzMpLiAqL1xudHlwZSBDb25zdHJ1Y3RLaW5kID0gJ2lmJyB8ICdsb29wJyB8ICdmb3InIHwgJ3NlbGVjdCcgfCAnYnJhY2UnO1xuXG4vKiogT25lIG9wZW4gY29uc3RydWN0OiBpdHMga2luZCwgYW5kIHdoZXRoZXIgYSBib2R5IHdvcmQgaGFzIGJlZW4gc2Vlbi4gKi9cbmludGVyZmFjZSBPcGVuQ29uc3RydWN0IHtcbiAga2luZDogQ29uc3RydWN0S2luZDtcbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBib2R5IGhhcyBzdGFydGVkLiBGb3IgYGlmYCB0aGUgYm9keSBzdGFydHMgYXQgYHRoZW5gL2BlbHNlYC9cbiAgICogYGVsaWZgLCBmb3IgbG9vcHMgYXQgYGRvYCwgZm9yIGJyYWNlIGdyb3VwcyBhdCBhbnkgY29tbWFuZCB3b3JkIFx1MjAxNCBhXG4gICAqIGNsb3NlciB3aXRoIG5vIGJvZHkgKGBpZiB4OyBmaWAsIGB7IH1gKSBpcyBhIEJhc2ggcGFyc2UgZXJyb3IuXG4gICAqL1xuICBib2R5OiBib29sZWFuO1xufVxuXG4vKiogVGhlIGNhc2UgcmVnaW9uJ3MgcG9zaXRpb24gc3RhdGUgKHBsYW4gXHUwMEE3MykuICovXG50eXBlIENhc2VQb3MgPSAnc3ViamVjdCcgfCAncGF0dGVybi1zdGFydCcgfCAncGF0dGVybicgfCAnY29tbWFuZCc7XG5cbi8qKiBBbiBvcGVuIGNhc2UgcmVnaW9uOiBvcGFxdWUgY29udGVudCBvd25lZCBieSB0aGUgY2FzZSBzY2FuLiAqL1xuaW50ZXJmYWNlIENhc2VSZWdpb24ge1xuICBwb3M6IENhc2VQb3M7XG4gIC8qKiBJbiBhIGBjb21tYW5kYCBwb3NpdGlvbjogd2hldGhlciB0aGUgY3VycmVudCBsaXN0IGl0ZW0gaXMgc3RpbGwgZW1wdHkgKG9ubHkgYClgLCBgO2AsIGAmYCwgYW5kIG5ld2xpbmVzIHJlc2V0IGl0KS4gKi9cbiAgY21kRW1wdHk6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVnaW9uJ3Mgb3duIHBhcmVuIGRlcHRoIFx1MjAxNCBnbG9iYWwgcGFyZW4gZGVwdGggaXMgZnJvemVuIHdoaWxlIHRoZSByZWdpb24gaXMgb3BlbiAodGhlIHJlZ2lvbiBpcyBub3QgYSBzdGFjazsgaXQgb3V0bGl2ZXMgcGFyZW4gY2xvc2VzKS4gKi9cbiAgbG9jYWxEZXB0aDogbnVtYmVyO1xufVxuXG4vKiogQSBwZW5kaW5nIGhlcmVkb2Mgd2hvc2UgYm9keSBoYXMgbm90IHN0YXJ0ZWQgeWV0IChvciB3aG9zZSBib2R5IGlzIGJlaW5nIHNjYW5uZWQpLiAqL1xuaW50ZXJmYWNlIFBlbmRpbmdIZXJlZG9jIHtcbiAgLyoqIFRoZSBsaW5lIHRoYXQgY2xvc2VzIHRoZSBib2R5OiB0aGUgZGVsaW1pdGVyLCBvcHRpb25hbGx5IGBcXHRgLXByZWZpeGVkIGZvciBgPDwtYCwgd2l0aCBvcHRpb25hbCB0cmFpbGluZyB3aGl0ZXNwYWNlLiAqL1xuICBjbG9zZTogUmVnRXhwO1xufVxuXG4vKiogVGhlIHdvcmRzIHRoYXQgcHV0IHRoZSBwYXJzZXIgYmFjayBhdCBjb21tYW5kIHN0YXJ0IHdoZW4gdGhleSBhcmUgdGhlIGJ1ZmZlcidzIGxhc3Qgd29yZCAocGxhbiBcdTAwQTczKS4gKi9cbmNvbnN0IENPTU1BTkRfT1BFTkVSX1dPUkRTID0gbmV3IFNldChbJ2RvJywgJ3RoZW4nLCAnZWxzZScsICdlbGlmJywgJ2lmJywgJ3doaWxlJywgJ3VudGlsJywgJyEnLCAndGltZScsICd7JywgJygnXSk7XG5cbi8qKiBXb3JkIGNoYXJzIGVuZCBhdCB3aGl0ZXNwYWNlIGFuZCB0aGUgb3BlcmF0b3IvcGFyZW4vcmVkaXJlY3QgbWV0YWNoYXJzLiAqL1xuY29uc3QgV09SRF9FTkQgPSAvW1xcczsmfCgpPD5dLztcblxuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG59XG5cbi8qKlxuICogU3BsaXQgYSBjb21tYW5kIHN0cmluZyBpbnRvIHNpbXBsZS1jb21tYW5kIHN1YnN0cmluZ3MgYXQgdG9wLWxldmVsICYmLCB8fCxcbiAqIDssIHwsIHwmLCAmLCBhbmQgbmV3bGluZSBib3VuZGFyaWVzLiBRdW90ZXMgYW5kICQoKS9gYC8oKSBuZXN0aW5nIGFyZVxuICogcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKTsgYCNgIGNvbW1lbnRzIGFuZCBgJHtcdTIwMjZ9YCBicmFjZSBjb250ZW50IGFyZVxuICogb3BhcXVlLCBwaXBlL2FuZC9vciBuZXdsaW5lcyBhcmUgbGluZSBjb250aW51YXRpb25zLCBhbmQgQmFzaCBwYXJzZSBlcnJvcnNcbiAqIChwbGFuIFx1MDBBNzEpIGNvbWUgYmFjayBhcyBhIGBtYWxmb3JtZWRgIHZlcmRpY3Qgd2l0aCB0aGUgc3RhZ2UgbGlzdCB0cnVuY2F0ZWRcbiAqIGF0IHRoZSByZWplY3RpbmcgbGlzdC5cbiAqXG4gKiBQaGFzZSAyIChwbGFuIFx1MDBBNzMpIGFkZHMgdGhyZWUgbWFjaGluZXM6XG4gKlxuICogLSBUaGUga2luZC1tYXRjaGVkIGNvbnN0cnVjdCBzdGFjazogYGlmYC9gd2hpbGVgL2B1bnRpbGAvYGZvcmAvYHNlbGVjdGAvXG4gKiAgIGB7YC9gfWAvYGZ1bmN0aW9uYCBvcGVuIGNvbnN0cnVjdCBmcmFtZXMgYXQgY29tbWFuZCBwb3NpdGlvbiwgY29udGV4dFxuICogICBrZXl3b3JkcyAoYGRvYCwgYHRoZW5gLCBgZWxzZWAsIGBlbGlmYCwgYGluYCkgYW5kIGNsb3NlcnMgKGBmaWAsIGBkb25lYCxcbiAqICAgYGVzYWNgLCBgfWApIHJlcXVpcmUgYSBtYXRjaGluZyBvcGVuZXIgb24gdG9wIG9mIHRoZSBzdGFjayAod2l0aCB0aGVcbiAqICAgcmlnaHQgYm9keSBzdGF0ZSksIGFuZCB3aGlsZSBhIGNvbnN0cnVjdCBpcyBvcGVuIGF0IGRlcHRoIDAgdGhlIGJvdW5kYXJ5XG4gKiAgIG9wZXJhdG9ycyBhcmUgdGV4dCBcdTIwMTQgdGhlIGNvbnN0cnVjdCBmb2xkcyB0byBvbmUgc3RhZ2UuIEVhY2ggYChgIHB1c2hlcyBhXG4gKiAgIGZyZXNoIHN0YWNrIGFuZCBlYWNoIGApYCBmaXJlcyAndW5jbG9zZWQtY29uc3RydWN0JyB3aGVuIGl0cyBsZXZlbCBpc1xuICogICBub24tZW1wdHkgKGZpcmUtYmVmb3JlLXJlc3RvcmUpLlxuICpcbiAqIC0gVGhlIGNhc2UtcmVnaW9uIG1hY2hpbmU6IGBjYXNlYCBpbiBjb21tYW5kIHBvc2l0aW9uIG9wZW5zIGEgcmVnaW9uIGNsb3NlZFxuICogICBieSBhIG1hdGNoaW5nIGBlc2FjYC4gVGhlIHJlZ2lvbidzIGNvbnRlbnQgaXMgb3BhcXVlIFx1MjAxNCBwYXR0ZXJuIGApYHMgYW5kXG4gKiAgIGB8YHMgYXJlIHBhdHRlcm4gc3ludGF4LCBub3QgcGFyZW5zL3BpcGVzIFx1MjAxNCB3aXRoIGl0cyBvd24gcGFyZW4gZGVwdGhcbiAqICAgKHRoZSBnbG9iYWwgZGVwdGggZnJlZXplcyB3aGlsZSBvcGVuKSwgYDs7YC9gOyZgL2A7OyZgIHJldHVybmluZyB0b1xuICogICBwYXR0ZXJuLXN0YXJ0IGFuZCBgKWAsIGA7YCwgYCZgLCBhbmQgbmV3bGluZXMgdG8gY29tbWFuZCBzdGFydC4gQSByZWdpb25cbiAqICAgb3BlbiBhdCBFT0YgaXMgJ3VuY2xvc2VkLWNhc2UnLlxuICpcbiAqIC0gVGhlIGhlcmVkb2MgbWFjaGluZXJ5OiBgPDxgL2A8PC1gIGF0IGRlcHRoIDAgd2l0aCBhIGRlbGltaXRlciB3b3JkIHN0cmlwc1xuICogICB0aGUgb3BlcmF0b3IrZGVsaW1pdGVyIGZyb20gdGhlIHN0YWdlIHRleHQgKHRoZSBzdGFnZSBrZWVwcyBhIHBsYWluIGFyZ3YpXG4gKiAgIGFuZCBzY2FucyBib2R5IGxpbmVzIHJhdyB1bnRpbCB0aGUgZGVsaW1pdGVyIGxpbmU7IGFuIHVudGVybWluYXRlZFxuICogICBoZXJlZG9jIGlzIHRoZSAndW50ZXJtaW5hdGVkLWhlcmVkb2MnIHBhcnRpYWwgXHUyMDE0IHRoZSBkZWxpbWl0ZXIncyBsaW5lIChhbmRcbiAqICAgZXZlcnl0aGluZyBiZWZvcmUgaXQpIGFuYWx5emVzIG5vcm1hbGx5IGFuZCB0aGUgYm9keSBwcm9kdWNlcyBubyBzdGFnZXMuXG4gKiAgIFRoZSBzdHJpcHBlZCBzdGFnZSBjYXJyaWVzIHRoZSBgaGVyZWRvY2AgZmxhZyBzbyBjb25zdW1lcnMgY2FuIHNlZSB0aGF0XG4gKiAgIGl0cyBzdGRpbiBpcyB0aGUgYm9keSwgbm90IGEgcGlwZSBvciBhIGZpbGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU3BsaXRSZXN1bHQge1xuICBjb25zdCBwYXJ0czogU2ltcGxlQ29tbWFuZFtdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gY21kLmxlbmd0aDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGJyYWNlRGVwdGggPSAwO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBwZW5kaW5nT3A6IE9wZXJhdG9yID0gJ3N0YXJ0JztcbiAgLyoqIFNldCB3aGVuIHRoZSBjdXJyZW50IGxpc3QgaXMgYSBCYXNoIHBhcnNlIGVycm9yOyB0aGUgc2NhbiBzdG9wcyBhdCBpdCAocGxhbiBcdTAwQTcxLCBsaXN0LXNjb3BlICsgdGVybWluYWwpLiAqL1xuICBsZXQgbWFsZm9ybWVkOiBNYWxmb3JtZWRWZXJkaWN0IHwgdW5kZWZpbmVkO1xuICAvKiogSW5kZXggaW50byBgcGFydHNgIHdoZXJlIHRoZSBjdXJyZW50IGxpc3QgYmVnYW4gXHUyMDE0IHRoZSByZWplY3RpbmcgbGlzdCdzIHN0YWdlcyBhcmUgZHJvcHBlZCBieSByb2xsaW5nIGJhY2sgdG8gaXQuICovXG4gIGxldCBsaXN0U3RhcnQgPSAwO1xuXG4gIC8qKiBSZXBvcnQgYSBtYWxmb3JtZWQgbGlzdDogZHJvcCBpdHMgc3RhZ2VzIChjb21wbGV0ZWQgZWFybGllciBsaXN0cyBzdGF5KSwgYW5kIHN0b3AgdGhlIHNjYW4gXHUyMDE0IGJhc2ggYWJvcnRzIGF0IHRoZSBmaXJzdCBwYXJzZSBlcnJvci4gKi9cbiAgY29uc3QgcmVqZWN0ID0gKHY6IE1hbGZvcm1lZFZlcmRpY3QpID0+IHtcbiAgICBtYWxmb3JtZWQgPSB2O1xuICAgIHBhcnRzLmxlbmd0aCA9IGxpc3RTdGFydDtcbiAgICBpID0gbjtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciBhIHBpcGUvYW5kL29yIG9wZXJhdG9yIGlzIHBlbmRpbmcgd2l0aCBhIHdoaXRlc3BhY2Utb25seSBidWZmZXJcbiAgICogc2luY2UgaXQuIEEgaGVscGVyIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3NcbiAgICogY29udHJvbC1mbG93IG5hcnJvd2luZyBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvXG4gICAqIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0cyBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGVcbiAgICogZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzVW5jb25zdW1lZE9wZXJhdG9yID0gKCk6IGJvb2xlYW4gPT5cbiAgICAocGVuZGluZ09wID09PSAncGlwZScgfHwgcGVuZGluZ09wID09PSAnYW5kJyB8fCBwZW5kaW5nT3AgPT09ICdvcicpICYmIGJ1Zi50cmltKCkgPT09ICcnO1xuXG4gIC8qKiBUaGUgYnVmZmVyJ3MgbGFzdCB3aGl0ZXNwYWNlLWRlbGltaXRlZCB3b3JkICgnJyB3aGVuIHRoZSBidWZmZXIgaXMgZW1wdHkpLiAqL1xuICBjb25zdCBsYXN0V29yZCA9ICgpOiBzdHJpbmcgPT4gYnVmLnRyaW1FbmQoKS5tYXRjaCgvXFxTKyQvKT8uWzBdID8/ICcnO1xuXG4gIC8qKlxuICAgKiBSZWRpcmVjdCBvcGVyYXRvcnMgdGhhdCBhcmUgbWlzc2luZyB0aGVpciB0YXJnZXQgd29yZCB3aGVuIHRoZXkgYXJlIHRoZVxuICAgKiBidWZmZXIncyBsYXN0IHdvcmQgKHBsYW4gXHUwMEE3MSk6IGEgdGFyZ2V0IG11c3QgYmUgYSBwbGFpbiB3b3JkLCBzbyBldmVyeVxuICAgKiBub24tc2VsZi1jb21wbGV0ZSBmb3JtIGlzIGEgcGFyc2UgZXJyb3IuIER1cCBmb3JtcyB3aXRoIGJvdGggZmRzIHByZXNlbnRcbiAgICogKGAyPiYxYCwgYD4mLWAsIGAzPCYwYCkgYW5kIGZ1c2VkIHdvcmRzIChgPm91dGAsIGAyPmVycmAsIGA8PEVPRmAsXG4gICAqIGAmPm91dGApIGFyZSBjb21wbGV0ZSBhbmQgbmV2ZXIgbWF0Y2guXG4gICAqL1xuICBjb25zdCBEQU5HTElOR19SRURJUkVDVF9XT1JEID0gL14oPzo+fD4+fCY+fCY+Pnw+XFx8fDx8PD58PDx8PDwtfDw8PHw+JnxcXGQrKD86Pnw+Pnw+XFx8fDx8PD58PDx8PDwtfDw8PHw+Jnw8JikpJC87XG5cbiAgY29uc3QgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QgPSAoKTogYm9vbGVhbiA9PiBEQU5HTElOR19SRURJUkVDVF9XT1JELnRlc3QobGFzdFdvcmQoKSk7XG5cbiAgLyoqIFdoZXRoZXIgdGhlIGN1cnJlbnQgY2hhciBzdGFydHMgYSBuZXcgd29yZCBpbiB0aGUgYnVmZmVyIChlbXB0eSBidWZmZXIsIG9yIHByZWNlZGVkIGJ5IHdoaXRlc3BhY2UpLiAqL1xuICBjb25zdCBpc1dvcmRTdGFydCA9ICgpOiBib29sZWFuID0+IGJ1ZiA9PT0gJycgfHwgL1xccyQvLnRlc3QoYnVmKTtcblxuICAvKiogV2hldGhlciBhIHJlZGlyZWN0IHRva2VuIGJlZ2lucyBhdCBgaWA6IGEgYD5gL2A8YCBmb3JtLCBgJj5gLCBvciBhIGRpZ2l0LXByZWZpeGVkIGZvcm0gbGlrZSBgMj5gL2AyPiYxYC4gKi9cbiAgY29uc3Qgc3RhcnRzUmVkaXJlY3RBdCA9IChpOiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChjID09PSAnPicgfHwgYyA9PT0gJzwnKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoYyA9PT0gJyYnKSByZXR1cm4gY21kW2kgKyAxXSA9PT0gJz4nO1xuICAgIGlmIChjID49ICcwJyAmJiBjIDw9ICc5Jykge1xuICAgICAgbGV0IGogPSBpO1xuICAgICAgd2hpbGUgKGogPCBuICYmIGNtZFtqXSA+PSAnMCcgJiYgY21kW2pdIDw9ICc5JykgaiArPSAxO1xuICAgICAgcmV0dXJuIGNtZFtqXSA9PT0gJz4nIHx8IGNtZFtqXSA9PT0gJzwnO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBuZXcgY29tbWFuZCBjYW4gc3RhcnQgaGVyZTogdGhlIGJ1ZmZlciBpcyBlbXB0eSwgYSBib3VuZGFyeVxuICAgKiBvcGVyYXRvciBvciBgKGAvYClgIHByZWNlZGVzLCB0aGUgYnVmZmVyIGVuZHMgd2l0aCBhIG5ld2xpbmUgKGEgbmV3bGluZVxuICAgKiBpbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgaXMgdGV4dCBidXQgc3RpbGwgZW5kcyB0aGUgbGlzdCBpdGVtKSwgb3IgdGhlXG4gICAqIGxhc3Qgd29yZCBleHBlY3RzIGEgY29tbWFuZCBib2R5IChgdGhlbmAsIGBkb2AsIGB7YCwgXHUyMDI2KS5cbiAgICovXG4gIGNvbnN0IGlzQ29tbWFuZFBvc2l0aW9uID0gKCk6IGJvb2xlYW4gPT5cbiAgICBidWYudHJpbSgpID09PSAnJyB8fCAvXFxuJC8udGVzdChidWYpIHx8IC9bOyZ8KCldJC8udGVzdChidWYudHJpbUVuZCgpKSB8fCBDT01NQU5EX09QRU5FUl9XT1JEUy5oYXMobGFzdFdvcmQoKSk7XG5cbiAgY29uc3QgZmx1c2ggPSAobmV4dE9wOiBPcGVyYXRvcikgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSB7XG4gICAgICAvLyBgIWAgaW4gcGlwZSBwb3NpdGlvbiBpcyBhIHBhcnNlIGVycm9yIChwbGFuIFx1MDBBNzEpOiB0aGUgZmlyc3Qgd29yZCBvZiBhXG4gICAgICAvLyBwaXBlLXByZWNlZGVkIHN0YWdlIG1heSBub3QgYmUgYCFgIChgZmFsc2UgfCAhIHRydWVgLCBgY2F0IGYgfFxcbiEgdHJ1ZWApLlxuICAgICAgaWYgKHBlbmRpbmdPcCA9PT0gJ3BpcGUnICYmIChzID09PSAnIScgfHwgL14hXFxzLy50ZXN0KHMpKSkge1xuICAgICAgICByZWplY3QoJ3BpcGUtYmFuZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wLCAuLi4oYnVmSGVyZWRvYyA/IHsgaGVyZWRvYzogdHJ1ZSB9IDoge30pIH0pO1xuICAgIH1cbiAgICBidWYgPSAnJztcbiAgICBidWZIZXJlZG9jID0gZmFsc2U7XG4gICAgcGVuZGluZ09wID0gbmV4dE9wO1xuICB9O1xuXG4gIC8vIFRoZSBraW5kLW1hdGNoZWQgY29uc3RydWN0IHN0YWNrLCBvbmUgbGlzdCBwZXIgcGFyZW4gbGV2ZWw6IGAoYCBwdXNoZXMgYVxuICAvLyBmcmVzaCBsZXZlbCwgYClgIHBvcHMgaXQgYW5kIGZpcmVzIHdoZW4gaXQgaXMgbm9uLWVtcHR5IFx1MjAxNCBhbiB1bmNsb3NlZFxuICAvLyBjb25zdHJ1Y3QgY2Fubm90IG91dGxpdmUgdGhlIHN1YnNoZWxsIHRoYXQgY2xvc2VkIChwbGFuIFx1MDBBNzMpLlxuICBjb25zdCBsZXZlbHM6IE9wZW5Db25zdHJ1Y3RbXVtdID0gW1tdXTtcbiAgY29uc3QgdG9wID0gKCk6IE9wZW5Db25zdHJ1Y3QgfCB1bmRlZmluZWQgPT4ge1xuICAgIGNvbnN0IGx2ID0gbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gbHYubGVuZ3RoID4gMCA/IGx2W2x2Lmxlbmd0aCAtIDFdIDogdW5kZWZpbmVkO1xuICB9O1xuICAvKiogU2V0IGJ5IG9wZW5lcnMgYW5kIGJvZHkga2V5d29yZHMsIGNsZWFyZWQgYnkgb3RoZXIgd29yZHMgYW5kIGAoYCBcdTIwMTQgYW4gb3BlcmF0b3Igb3IgY2xvc2VyIGRpcmVjdGx5IGFmdGVyIGl0IGlzIGFuIGVtcHR5LWxpc3QgcGFyc2UgZXJyb3IgKGBpZiB0cnVlOyB0aGVuOyBmaWAsIGB7IDsgfWApLiAqL1xuICBsZXQgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gIC8qKiBgZnVuY3Rpb25gIHNlZW47IHRoZSBuZXh0IHdvcmQgaXMgdGhlIGZ1bmN0aW9uIG5hbWUsIGFuZCBge2AgcmlnaHQgYWZ0ZXIgaXQgb3BlbnMgdGhlIGRlZmluaXRpb24gYm9keS4gKi9cbiAgbGV0IGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICBsZXQgbmFtZVNlZW4gPSBmYWxzZTtcblxuICAvLyBUaGUgb3BlbiBjYXNlIHJlZ2lvbiwgaWYgYW55IChwbGFuIFx1MDBBNzMpLiBXaGlsZSBvcGVuLCBpdHMgY29udGVudCBpcyBvcGFxdWVcbiAgLy8gdG8gZXZlcnkgb3RoZXIgbWFjaGluZTogdGhlIGdsb2JhbCBwYXJlbiBkZXB0aCBpcyBmcm96ZW4sIHRoZSBjb25zdHJ1Y3RcbiAgLy8gc3RhY2sgaXMgdW50b3VjaGVkLCBhbmQgYm91bmRhcnkgb3BlcmF0b3JzIGFyZSB0ZXh0LlxuICBsZXQgY2FzZVJlZ2lvbjogQ2FzZVJlZ2lvbiB8IG51bGwgPSBudWxsO1xuXG4gIC8vIFBlbmRpbmcgaGVyZWRvY3MgKHBsYW4gXHUwMEE3Myk6IGA8PGAvYDw8LWAgYXQgZGVwdGggMCB3aXRoIGEgZGVsaW1pdGVyIHdvcmQuXG4gIGNvbnN0IGhlcmVkb2NzOiBQZW5kaW5nSGVyZWRvY1tdID0gW107XG4gIC8qKiBJbiB0aGUgYm9keSBvZiBhIHBlbmRpbmcgaGVyZWRvYyBcdTIwMTQgbGluZXMgYXJlIHNjYW5uZWQgcmF3IGZvciB0aGUgY2xvc2UgbGluZS4gKi9cbiAgbGV0IGluQm9keSA9IGZhbHNlO1xuICAvKiogV2hldGhlciB0aGUgc3RhZ2UgY3VycmVudGx5IGluIHRoZSBidWZmZXIgZmVlZHMgaXRzIHN0ZGluIGZyb20gYSBoZXJlZG9jIGJvZHkgKHN1cmZhY2VkIG9uIHRoZSBmbHVzaGVkIFNpbXBsZUNvbW1hbmQpLiAqL1xuICBsZXQgYnVmSGVyZWRvYyA9IGZhbHNlO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgYnVmICs9IGNtZFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgYnVmICs9IGMgKyBjbWRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIGAke1x1MjAyNn1gIGNvbnRlbnQgaXMgb3BhcXVlIChwbGFuIFx1MDBBNzEpOiBuZXN0ZWQgZXhwYW5zaW9ucyBuZXN0LCBhbmQgd2hpbGVcbiAgICAvLyB0aGUgYnJhY2UgZGVwdGggaXMgcG9zaXRpdmUgbm90aGluZyBpbnNpZGUgY291bnRzIHBhcmVucywgc3BsaXRzXG4gICAgLy8gb3BlcmF0b3JzLCBzdGFydHMgY29tbWVudHMsIG9yIHJlY29nbml6ZXMgY29uc3RydWN0cyBcdTIwMTQgYCR7eCUpfWAsXG4gICAgLy8gYCR7eC8vKC99YCwgYW5kIGAke3g6LSQoZWNobyB5KX1gIGFyZSBhbGwgdmFsaWQuXG4gICAgaWYgKGJyYWNlRGVwdGggPiAwKSB7XG4gICAgICBpZiAoYyA9PT0gJ30nKSBicmFjZURlcHRoIC09IDE7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBIZXJlZG9jIGJvZHkgbW9kZTogc2NhbiBsaW5lcyByYXcgdW50aWwgdGhlIGZpcnN0IHBlbmRpbmcgaGVyZWRvYydzXG4gICAgLy8gY2xvc2UgbGluZSAoYSBsaW5lIHRoYXQgaXMgZXhhY3RseSB0aGUgZGVsaW1pdGVyLCBvcHRpb25hbGx5IHRhYi1cbiAgICAvLyBwcmVmaXhlZCBmb3IgYDw8LWAsIHdpdGggb3B0aW9uYWwgdHJhaWxpbmcgd2hpdGVzcGFjZSkuIFRoZSBib2R5IGlzXG4gICAgLy8gb3BhcXVlIFx1MjAxNCBpdCBwcm9kdWNlcyBubyBzdGFnZXMgXHUyMDE0IGFuZCB1bnRlcm1pbmF0ZWQgYm9kaWVzIGVuZCBhdCBFT0YuXG4gICAgaWYgKGluQm9keSkge1xuICAgICAgY29uc3QgbGluZUVuZCA9IGNtZC5pbmRleE9mKCdcXG4nLCBpKTtcbiAgICAgIGNvbnN0IGxpbmUgPSBsaW5lRW5kID09PSAtMSA/IGNtZC5zbGljZShpKSA6IGNtZC5zbGljZShpLCBsaW5lRW5kKTtcbiAgICAgIGlmIChoZXJlZG9jc1swXS5jbG9zZS50ZXN0KGxpbmUpKSB7XG4gICAgICAgIGhlcmVkb2NzLnNoaWZ0KCk7XG4gICAgICAgIGlmIChoZXJlZG9jcy5sZW5ndGggPT09IDApIGluQm9keSA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgIC8vIEluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCB0aGUgYm9keSBsaW5lIGZvbGRzIGludG8gdGhlIGNvbnN0cnVjdCdzXG4gICAgICAgIC8vIGludGVyaW9yIHRleHQgKGEgbmV3bGluZSBpbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgaXMgbm90IGFcbiAgICAgICAgLy8gYm91bmRhcnksIHBsYW4gXHUwMEE3MSkgXHUyMDE0IHRoZSBpbnRlcmlvciByZS1zcGxpdCByZS1zY2FucyBpdCBhcyBib2R5LlxuICAgICAgICBidWYgKz0gbGluZTtcbiAgICAgICAgaWYgKGxpbmVFbmQgIT09IC0xKSBidWYgKz0gJ1xcbic7XG4gICAgICB9XG4gICAgICBpID0gbGluZUVuZCA9PT0gLTEgPyBuIDogbGluZUVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIG5ld2xpbmUgcmlnaHQgYWZ0ZXIgYSBoZXJlZG9jJ3MgZGVsaW1pdGVyIGxpbmUgZW5kcyB0aGUgZGVsaW1pdGVyJ3NcbiAgICAvLyBsaW5lIFx1MjAxNCBpdCBzcGxpdHMgbm9ybWFsbHkgKGEgY29tcGxldGVkIGxpc3QsIGJ1dCB3aXRob3V0IGFkdmFuY2luZ1xuICAgIC8vIGBsaXN0U3RhcnRgOiBhIGNvbXBsZXRlbmVzcyB2aW9sYXRpb24gdGhhdCByZWplY3RzIGxhdGVyIGRyb3BzIHRoZVxuICAgIC8vIGRlbGltaXRlcidzLWxpbmUgc3RhZ2UgdG9vKSBcdTIwMTQgYW5kIHN0YXJ0cyB0aGUgYm9keS4gSW5zaWRlIGFuIG9wZW5cbiAgICAvLyBjb25zdHJ1Y3QgdGhlIG5ld2xpbmUgaXMgbm90IGEgYm91bmRhcnk6IHRoZSBkZWxpbWl0ZXIncyBsaW5lLCB0aGVcbiAgICAvLyBib2R5LCBhbmQgdGhlIGNsb3NlIGxpbmUgYWxsIGZvbGQgaW50byB0aGUgY29uc3RydWN0J3Mgb25lIHN0YWdlLCBhbmRcbiAgICAvLyB0aGUgd2FsaydzIGludGVyaW9yIHJlLXNwbGl0IGFwcGxpZXMgdGhlIHNhbWUgaGVyZWRvYyBtYWNoaW5lcnkgdGhlcmUuXG4gICAgaWYgKGMgPT09ICdcXG4nICYmIGhlcmVkb2NzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgfHwgY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgICAgICBidWYgKz0gYztcbiAgICAgICAgaW5Cb2R5ID0gdHJ1ZTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gICAgICBpbkJvZHkgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIGAjYCBiZWdpbnMgYSBjb21tZW50IHdoZW4gaXQgc3RhcnRzIGEgd29yZCBhdCBkZXB0aCAwIChlbXB0eSBidWZmZXIgb3JcbiAgICAvLyBwcmVjZWRlZCBieSB3aGl0ZXNwYWNlKTsgY29tbWVudHMgcnVuIHRvIHRoZSBuZXdsaW5lLCBrZWVwaW5nIHRoZSBidWZmZXJcbiAgICAvLyBlbXB0eSBmb3IgdGhlIGNvbnRpbnVhdGlvbiBydWxlLiBNaWQtd29yZCBhbmQgcXVvdGVkIGAjYCBhcmUgdGV4dCwgYW5kXG4gICAgLy8gY29tbWVudHMgaW5zaWRlIHBhcmVucyBhcmUgb3BhcXVlIGxpa2UgZXZlcnl0aGluZyBlbHNlIHRoZXJlIChwbGFuIFx1MDBBNzEpLlxuICAgIGlmIChjID09PSAnIycgJiYgZGVwdGggPT09IDAgJiYgaXNXb3JkU3RhcnQoKSkge1xuICAgICAgd2hpbGUgKGkgPCBuICYmIGNtZFtpXSAhPT0gJ1xcbicpIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgY2FzZS1yZWdpb24gc2NhbiBvd25zIGV2ZXJ5dGhpbmcgYXQgaXRzIGxvY2FsIGRlcHRoIDAgXHUyMDE0IHBhdHRlcm5cbiAgICAvLyBzeW50YXgsIGxpc3QgdGVybWluYXRvcnMsIGFuZCB3b3JkcyBcdTIwMTQgd2hpbGUgdGhlIHJlZ2lvbiBpcyBvcGVuLlxuICAgIGlmIChjYXNlUmVnaW9uKSB7XG4gICAgICBjb25zdCByID0gY2FzZVJlZ2lvbjtcbiAgICAgIGlmIChyLmxvY2FsRGVwdGggPT09IDApIHtcbiAgICAgICAgY29uc3QgczIgPSBjbWQuc2xpY2UoaSwgaSArIDIpO1xuICAgICAgICBjb25zdCBzMyA9IGNtZC5zbGljZShpLCBpICsgMyk7XG4gICAgICAgIC8vIGA7O2AvYDsmYC9gOzsmYCBlbmQgdGhlIGN1cnJlbnQgcGF0dGVybiBsaXN0IFx1MjAxNCBiYWNrIHRvIHBhdHRlcm4tc3RhcnQuXG4gICAgICAgIGlmIChzMyA9PT0gJzs7JicgfHwgczIgPT09ICc7OycgfHwgczIgPT09ICc7JicpIHtcbiAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuLXN0YXJ0JztcbiAgICAgICAgICBidWYgKz0gczMgPT09ICc7OyYnID8gczMgOiBzMjtcbiAgICAgICAgICBpICs9IHMzID09PSAnOzsmJyA/IDMgOiAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIGA7YCByZXR1cm5zIHRvIGNvbW1hbmQgc3RhcnQgKGEgYDs7YCB3YXMgaGFuZGxlZCBhYm92ZSkuXG4gICAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgICByLnBvcyA9ICdjb21tYW5kJztcbiAgICAgICAgICByLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQSBzaW5nbGUgYCZgIChub3QgcGFydCBvZiBhIHJlZGlyZWN0IG9yIGAmJmApIGlzIHRoZSBiYWNrZ3JvdW5kXG4gICAgICAgIC8vIG9wZXJhdG9yIFx1MjAxNCBhbHNvIGNvbW1hbmQgc3RhcnQuXG4gICAgICAgIGNvbnN0IGxhc3QgPSBidWZbYnVmLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoYyA9PT0gJyYnICYmIGNtZFtpICsgMV0gIT09ICc+JyAmJiBjbWRbaSArIDFdICE9PSAnJicgJiYgbGFzdCAhPT0gJz4nICYmIGxhc3QgIT09ICc8Jykge1xuICAgICAgICAgIHIucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgICAvLyBBIHBhdHRlcm4gY2Fubm90IGNvbnRpbnVlIGFjcm9zcyBhIG5ld2xpbmUgKGJhc2ggZXJyb3JzKSwgYnV0IGFcbiAgICAgICAgICAvLyBuZXdsaW5lIGFmdGVyIGBpbmAgb3IgaW5zaWRlIGEgbGlzdCBpdGVtIGlzIGZpbmUuXG4gICAgICAgICAgaWYgKHIucG9zID09PSAncGF0dGVybicpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY2FzZScpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyLnBvcyA9PT0gJ2NvbW1hbmQnKSByLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICcjJyAmJiBpc1dvcmRTdGFydCgpKSB7XG4gICAgICAgICAgLy8gQSBjb21tZW50IGluc2lkZSB0aGUgcmVnaW9uIHJ1bnMgdG8gdGhlIG5ld2xpbmUgbGlrZSBvdXRzaWRlLlxuICAgICAgICAgIHdoaWxlIChpIDwgbiAmJiBjbWRbaV0gIT09ICdcXG4nKSBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGlzV29yZFN0YXJ0KCkgJiYgIVdPUkRfRU5ELnRlc3QoYykpIHtcbiAgICAgICAgICBsZXQgaiA9IGk7XG4gICAgICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgICAgICBjb25zdCB3ID0gY21kLnNsaWNlKGksIGopO1xuICAgICAgICAgIC8vIGBlc2FjYCBjbG9zZXMgYXQgYSBwYXR0ZXJuLWxpc3Qgc3RhcnQgb3IgYXQgdGhlIHN0YXJ0IG9mIGEgbGlzdFxuICAgICAgICAgIC8vIGl0ZW07IGVsc2V3aGVyZSBpdCBpcyBhbiBvcmRpbmFyeSB3b3JkIChgZWNobyBlc2FjYCwgYGF8ZXNhYylgKSxcbiAgICAgICAgICAvLyBhcyBpcyBgY2FzZWAgaW4gdGhlIHN1YmplY3QgKGBjYXNlIGVzYWMgaW4gXHUyMDI2YCkuXG4gICAgICAgICAgaWYgKHcgPT09ICdlc2FjJyAmJiAoci5wb3MgPT09ICdwYXR0ZXJuLXN0YXJ0JyB8fCAoci5wb3MgPT09ICdjb21tYW5kJyAmJiByLmNtZEVtcHR5KSkpIHtcbiAgICAgICAgICAgIGNhc2VSZWdpb24gPSBudWxsO1xuICAgICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnaW4nICYmIHIucG9zID09PSAnc3ViamVjdCcpIHtcbiAgICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4tc3RhcnQnO1xuICAgICAgICAgIH0gZWxzZSBpZiAoci5wb3MgPT09ICdwYXR0ZXJuLXN0YXJ0Jykge1xuICAgICAgICAgICAgci5wb3MgPSAncGF0dGVybic7XG4gICAgICAgICAgfSBlbHNlIGlmIChyLnBvcyA9PT0gJ2NvbW1hbmQnKSB7XG4gICAgICAgICAgICByLmNtZEVtcHR5ID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJ1ZiArPSB3O1xuICAgICAgICAgIGkgPSBqO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBMb2NhbCBkZXB0aCA+IDAgb3Igbm9uLXdvcmQgY2hhcnMgZmFsbCB0aHJvdWdoIHRvIHRoZSBwYXJlbiBicmFuY2hlc1xuICAgICAgLy8gYW5kIHRoZSBnZW5lcmljIGJ1ZmZlci5cbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgICAgY2FzZVJlZ2lvbi5sb2NhbERlcHRoICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBIHN1YnNoZWxsIHN0YXJ0cyBhIGNvbW1hbmQgXHUyMDE0IGBpZiB0cnVlOyB0aGVuICggZWNobyBoaSApOyBmaWAgaXNcbiAgICAgICAgLy8gdmFsaWQgd2hpbGUgYGlmIHRydWU7IHRoZW47IGZpYCBpcyBub3Q7IHRoZSBzYW1lIHN1YnNoZWxsIGNvdW50cyBhc1xuICAgICAgICAvLyBhIGJvZHkgd29yZCBmb3IgYW4gZW5jbG9zaW5nIGJyYWNlIGdyb3VwIChgeyAoIGVjaG8gaGkgKTsgfWApLlxuICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgIGlmICh0Py5raW5kID09PSAnYnJhY2UnKSB0LmJvZHkgPSB0cnVlO1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBsZXZlbHMucHVzaChbXSk7XG4gICAgICB9XG4gICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGlmIChjYXNlUmVnaW9uKSB7XG4gICAgICAgIC8vIEF0IGxvY2FsIGRlcHRoIDAgYSBgKWAgaXMgdGhlIHBhdHRlcm4gdGVybWluYXRvciAob3IgdGhlIGVuZCBvZiBhXG4gICAgICAgIC8vIGxpc3QgaXRlbSkgXHUyMDE0IHRoZSByZWdpb24gb3ducyBpdCBhbmQgdGhlIGdsb2JhbCBkZXB0aCBzdGF5cyBmcm96ZW4uXG4gICAgICAgIGlmIChjYXNlUmVnaW9uLmxvY2FsRGVwdGggPT09IDApIHtcbiAgICAgICAgICBjYXNlUmVnaW9uLnBvcyA9ICdjb21tYW5kJztcbiAgICAgICAgICBjYXNlUmVnaW9uLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYXNlUmVnaW9uLmxvY2FsRGVwdGggLT0gMTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQSBzdHJheSBgKWAgYXQgZGVwdGggMCAoYW5kIGJyYWNlIGRlcHRoIDAsIG91dHNpZGUgcXVvdGVzKSBpcyBhIHBhcnNlXG4gICAgICAgIC8vIGVycm9yIFx1MjAxNCBgZWNobyB4KSAmJiBcdTIwMjZgIChwbGFuIFx1MDBBNzEpLiBgKWAgaW5zaWRlIHF1b3RlcywgYCR7XHUyMDI2fWAsIGFuZFxuICAgICAgICAvLyBoZXJlZG9jIGJvZGllcyBuZXZlciByZWFjaGVzIHRoaXMgYnJhbmNoLlxuICAgICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgICByZWplY3QoJ3VuYmFsYW5jZWQtcGFyZW4nKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICAvLyBGaXJlLWJlZm9yZS1yZXN0b3JlOiBhbiB1bmNsb3NlZCBjb25zdHJ1Y3Qgb24gdGhlIGNsb3NpbmcgbGV2ZWxcbiAgICAgICAgLy8gY2Fubm90IG91dGxpdmUgdGhlIHN1YnNoZWxsIChwbGFuIFx1MDBBNzMpLlxuICAgICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgICBsZXZlbHMucG9wKCk7XG4gICAgICB9XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBDb25zdHJ1Y3Qga2V5d29yZHMgYW5kIHRoZSBjYXNlLXJlZ2lvbiBvcGVuZXI6IHJlY29nbml6ZWQgYXQgd29yZFxuICAgIC8vIHN0YXJ0cyBhdCBhbnkgcGFyZW4gZGVwdGggKGNvbnN0cnVjdHMgdHJhY2sgdGhyb3VnaCBzdWJzaGVsbHMpLCBvdXRzaWRlXG4gICAgLy8gcXVvdGVzLCAke1x1MjAyNn0sIGhlcmVkb2MgYm9kaWVzLCBhbmQgb3BlbiBjYXNlIHJlZ2lvbnMgKHRoZSByZWdpb24gc2NhblxuICAgIC8vIGFib3ZlIG93bnMgdGhvc2Ugd29yZHMpLiBXb3JkLWVuZCBjaGFycyAoYDtgLCBgJmAsIGB8YCwgYDxgLCBgPmApXG4gICAgLy8gbmV2ZXIgYmVnaW4gYSB3b3JkIGhlcmUuXG4gICAgaWYgKFxuICAgICAgIWNhc2VSZWdpb24gJiZcbiAgICAgICFXT1JEX0VORC50ZXN0KGMpICYmXG4gICAgICAoaXNXb3JkU3RhcnQoKSB8fCAvWygpXSQvLnRlc3QoYnVmKSkgJiZcbiAgICAgICEoYyA9PT0gJyQnICYmIGNtZFtpICsgMV0gPT09ICd7JylcbiAgICApIHtcbiAgICAgIGxldCBqID0gaTtcbiAgICAgIHdoaWxlIChqIDwgbiAmJiAhV09SRF9FTkQudGVzdChjbWRbal0pKSBqICs9IDE7XG4gICAgICBjb25zdCB3ID0gY21kLnNsaWNlKGksIGopO1xuICAgICAgY29uc3QgaXNGblNoYXBlID0gKCk6IGJvb2xlYW4gPT4gL15bQS1aYS16X11bQS1aYS16MC05X10qXFwoXFwpJC8udGVzdChsYXN0V29yZCgpKSB8fCBsYXN0V29yZCgpID09PSAnKCknO1xuICAgICAgaWYgKHcgPT09ICdpbicgJiYgdG9wKCkgIT09IHVuZGVmaW5lZCAmJiBbJ2ZvcicsICdzZWxlY3QnXS5pbmNsdWRlcyh0b3AoKSEua2luZCkpIHtcbiAgICAgICAgLy8gVGhlIGZvci9zZWxlY3Qgd29yZC1saXN0IHNlcGFyYXRvciBcdTIwMTQgcmVjb2duaXplZCB3aGVyZXZlciBpdCBhcHBlYXJzXG4gICAgICAgIC8vIHdoaWxlIGEgZm9yL3NlbGVjdCBpcyBvcGVuIChgZm9yIGkgaW4gYSBiYCwgYHNlbGVjdCB4IGluIGFgKS5cbiAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ3snICYmIChpc0NvbW1hbmRQb3NpdGlvbigpIHx8IGlzRm5TaGFwZSgpIHx8IChmdW5jdGlvblNlZW4gJiYgbmFtZVNlZW4pKSkge1xuICAgICAgICAvLyBge2Agb3BlbnMgYSBicmFjZSBncm91cCBhdCBjb21tYW5kIHBvc2l0aW9uLCBvciByaWdodCBhZnRlciBhXG4gICAgICAgIC8vIGZ1bmN0aW9uIG5hbWUgKGBmKCkge2AsIGBmKCl7YCwgYGZ1bmN0aW9uIGYge2ApLiBge2NhdGAgaXMgYSB3b3JkLlxuICAgICAgICBpZiAoZnVuY3Rpb25TZWVuICYmIG5hbWVTZWVuKSB7XG4gICAgICAgICAgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2JyYWNlJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKHcgPT09ICd9JyAmJiBpc0NvbW1hbmRQb3NpdGlvbigpKSB7XG4gICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgaWYgKGFmdGVyS2V5d29yZCB8fCB0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnYnJhY2UnIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucG9wKCk7XG4gICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIGlmIChpc0NvbW1hbmRQb3NpdGlvbigpKSB7XG4gICAgICAgIGlmICh3ID09PSAnY2FzZScpIHtcbiAgICAgICAgICBjYXNlUmVnaW9uID0geyBwb3M6ICdzdWJqZWN0JywgY21kRW1wdHk6IGZhbHNlLCBsb2NhbERlcHRoOiAwIH07XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IHRydWU7XG4gICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnaWYnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2lmJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnd2hpbGUnIHx8IHcgPT09ICd1bnRpbCcpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnbG9vcCcsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2ZvcicpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnZm9yJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnc2VsZWN0Jykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdzZWxlY3QnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdkbycpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnbG9vcCcsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHQuYm9keSA9IHRydWU7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAndGhlbicpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdlbHNlJyB8fCB3ID09PSAnZWxpZicpIHtcbiAgICAgICAgICAvLyBlbHNlL2VsaWYgcmVxdWlyZSBhIGJvZHkgYWxyZWFkeSBcdTIwMTQgYW4gZW1wdHkgaWYtbGlzdCBpcyBhbiBlcnJvci5cbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpbicpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnc2VsZWN0J10uaW5jbHVkZXModC5raW5kKSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZmknKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnaWYnIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZG9uZScpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnbG9vcCcsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZXNhYycpIHtcbiAgICAgICAgICAvLyBObyBvcGVuIHJlZ2lvbiBcdTIwMTQgYSBzdHJheSBlc2FjIGlzIGEgcGFyc2UgZXJyb3IuXG4gICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBpZiAoZnVuY3Rpb25TZWVuKSB7XG4gICAgICAgICAgICBpZiAobmFtZVNlZW4pIHtcbiAgICAgICAgICAgICAgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gICAgICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBuYW1lU2VlbiA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBbiBhcmd1bWVudC1wb3NpdGlvbiB3b3JkOiBub3RoaW5nIG9wZW5zLCB0aGUgZW1wdHktYm9keSBmbGFnXG4gICAgICAgIC8vIGNsZWFycywgYW5kIHRoZSBmdW5jdGlvbi1uYW1lIGhhbmRvZmYgYWR2YW5jZXMuXG4gICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICBpZiAoZnVuY3Rpb25TZWVuKSB7XG4gICAgICAgICAgaWYgKG5hbWVTZWVuKSB7XG4gICAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5hbWVTZWVuID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJ1ZiArPSB3O1xuICAgICAgaSA9IGo7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQSBgO2AvYCZgIGRpcmVjdGx5IGFmdGVyIGFuIG9wZW5lciBvciBib2R5IGtleXdvcmQgaXMgYW4gZW1wdHktbGlzdFxuICAgIC8vIHBhcnNlIGVycm9yIGF0IGFueSBkZXB0aCAoYGlmIHRydWU7IHRoZW47IGZpYCwgYHsgOyB9YCxcbiAgICAvLyBgZm9yIGkgaW4gYSBiOyBkbzsgZG9uZWAsIGAoIGlmIHRydWU7IHRoZW47IGZpIClgKS5cbiAgICBpZiAoY2FzZVJlZ2lvbiA9PT0gbnVsbCAmJiBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgJiYgKGMgPT09ICc7JyB8fCBjID09PSAnJicpICYmIGFmdGVyS2V5d29yZCkge1xuICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgIC8vIEEgcmVkaXJlY3QgdG9rZW4gd2l0aCBubyB0YXJnZXQgd29yZCwgaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgYW5vdGhlclxuICAgICAgLy8gcmVkaXJlY3QgdG9rZW4gbWlkLXN0YWdlLCBpcyBhIHBhcnNlIGVycm9yOiBgY2F0IGYgPiA+IG91dGAsXG4gICAgICAvLyBgY2F0IGYgPiAyPiYxYCwgYGNhdCBmID4gJj5vdXRgLCBgY2F0IGYgPiA8PDwgeGAgKHBsYW4gXHUwMEE3MSkuXG4gICAgICBpZiAoaXNXb3JkU3RhcnQoKSAmJiBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpICYmIHN0YXJ0c1JlZGlyZWN0QXQoaSkpIHtcbiAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJCcgJiYgY21kW2kgKyAxXSA9PT0gJ3snKSB7XG4gICAgICAgIGJyYWNlRGVwdGggKz0gMTtcbiAgICAgICAgYnVmICs9IGM7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBIZXJlLXN0cmluZyByZWNvZ25pdGlvbjogYDw8PGAgKGV4YWN0bHkgdGhyZWUgYDxgcywgbm90IGZkLXByZWZpeGVkKVxuICAgICAgLy8gaXMgYSB0d28tdG9rZW4gb3BlcmF0b3IgXHUyMDE0IGA8PDxgIHBsdXMgdGhlIHdvcmQgaXQgZmVlZHMgdG8gc3RkaW4gXHUyMDE0XG4gICAgICAvLyBOT1QgYSBoZXJlZG9jLiBUaGUgaGVyZWRvYyBicmFuY2ggYmVsb3cgd291bGQgb3RoZXJ3aXNlIGZpcmUgYXQgdGhlXG4gICAgICAvLyBTRUNPTkQgYDxgIChpdHMgYGNtZFtpKzJdICE9PSAnPCdgIHRlc3QgcGFzc2VzIG9uIHRoZSBmb2xsb3dpbmdcbiAgICAgIC8vIHdvcmQpLCByZWdpc3RlciB0aGF0IHdvcmQgYXMgYSBkZWxpbWl0ZXIsIGFuZCBtYXJrIHRoZSB3aG9sZVxuICAgICAgLy8gY29tbWFuZCBhbiB1bnRlcm1pbmF0ZWQgaGVyZWRvYyBcdTIwMTQgc28gdmFsaWQgYmFzaCBoZXJlLXN0cmluZ3NcbiAgICAgIC8vIChgY2F0IDw8PGhlbGxvYCwgYHJnIC1uIG5lZWRsZSAxIDIgPDw8ICd4J2ApIHdlcmUgcmVqZWN0ZWQgYW5kXG4gICAgICAvLyBmYWlsZWQgY2xvc2VkLiBUaGUgb3BlcmF0b3Igc3RheXMgaW4gdGhlIHN0YWdlIHRleHQgKG5vdGhpbmdcbiAgICAgIC8vIHN0cmlwcyBpdCksIHNvIHRoZSBxdW90ZS1hd2FyZSBoYXNVbnF1b3RlZFJlZGlyZWN0IHNjYW4gc3RpbGxcbiAgICAgIC8vIGFwcGxpZXMgdGhlIHN0ZGluLXJlZGlyZWN0IGdhdGU7IGNvbnN1bWluZyBhbGwgdGhyZWUgY2hhcmFjdGVyc1xuICAgICAgLy8ga2VlcHMgdGhlIHdhbGsgZnJvbSByZS1yZWNvZ25pemluZyBhIGhlcmVkb2MgYXQgdGhlIHNlY29uZCBgPGAuXG4gICAgICAvLyBMb25nZXIgYDxgIHJ1bnMgKGA8PDw8YCkgYW5kIGZkLXByZWZpeGVkIGZvcm1zIChgMjw8PGApIGFyZSBub3RcbiAgICAgIC8vIGhlcmUtc3RyaW5ncyB0byBiYXNoIChzeW50YXggZXJyb3IgLyBmZC1oZXJlZG9jIG1pc2ludGVycHJldGF0aW9uKVxuICAgICAgLy8gYW5kIGZhbGwgdGhyb3VnaCB0byB0aGUgaGVyZWRvYyBtaXNmaXJlLCB3aGljaCBrZWVwcyB0aGVtXG4gICAgICAvLyBtYWxmb3JtZWQgYW5kIGZhaWwtY2xvc2VkLlxuICAgICAgaWYgKGMgPT09ICc8JyAmJiBjbWRbaSArIDFdID09PSAnPCcgJiYgY21kW2kgKyAyXSA9PT0gJzwnICYmIGNtZFtpICsgM10gIT09ICc8JyAmJiBjbWRbaSAtIDFdICE9PSAnPCcpIHtcbiAgICAgICAgYnVmICs9ICc8PDwnO1xuICAgICAgICBpICs9IDM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gSGVyZWRvYyByZWNvZ25pdGlvbiAocGxhbiBcdTAwQTczKTogYDw8YC9gPDwtYCAobm90IGA8PDxgKSBhdCBkZXB0aCAwIHdpdGhcbiAgICAgIC8vIGEgZGVsaW1pdGVyIHdvcmQuIFRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgYXJlIHN0cmlwcGVkIGZyb20gdGhlIHN0YWdlXG4gICAgICAvLyB0ZXh0IFx1MjAxNCB0aGUgc3RhZ2Uga2VlcHMgYSBwbGFpbiBhcmd2IChgY2F0IGZgIHN0YXlzIGBjYXQgZmApLlxuICAgICAgaWYgKGMgPT09ICc8JyAmJiBjbWRbaSArIDFdID09PSAnPCcgJiYgY21kW2kgKyAyXSAhPT0gJzwnKSB7XG4gICAgICAgIGxldCBqID0gaSArIDI7XG4gICAgICAgIGxldCBhbGxvd1RhYnMgPSBmYWxzZTtcbiAgICAgICAgaWYgKGNtZFtqXSA9PT0gJy0nKSB7XG4gICAgICAgICAgYWxsb3dUYWJzID0gdHJ1ZTtcbiAgICAgICAgICBqICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgd2hpbGUgKGNtZFtqXSA9PT0gJyAnIHx8IGNtZFtqXSA9PT0gJ1xcdCcpIGogKz0gMTtcbiAgICAgICAgbGV0IGRlbGltID0gJyc7XG4gICAgICAgIGlmIChjbWRbal0gPT09IFwiJ1wiIHx8IGNtZFtqXSA9PT0gJ1wiJykge1xuICAgICAgICAgIGNvbnN0IHEgPSBjbWQuaW5kZXhPZihjbWRbal0sIGogKyAxKTtcbiAgICAgICAgICBpZiAocSA9PT0gLTEpIHtcbiAgICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKGogKyAxKTtcbiAgICAgICAgICAgIGogPSBuO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZShqICsgMSwgcSk7XG4gICAgICAgICAgICBqID0gcSArIDE7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHdvcmRTdGFydCA9IGo7XG4gICAgICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgICAgICBkZWxpbSA9IGNtZC5zbGljZSh3b3JkU3RhcnQsIGopO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkZWxpbSAhPT0gJycpIHtcbiAgICAgICAgICBoZXJlZG9jcy5wdXNoKHtcbiAgICAgICAgICAgIGNsb3NlOiBuZXcgUmVnRXhwKGBeJHthbGxvd1RhYnMgPyAnXFx0KicgOiAnJ30ke2VzY2FwZVJlZ0V4cChkZWxpbSl9WyBcXFxcdF0qJGApXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgLy8gVGhlIG9wZXJhdG9yK2RlbGltaXRlciBsZWF2ZSB0aGUgc3RhZ2UgdGV4dCBiZWxvdywgc28gbWFyayB0aGVcbiAgICAgICAgICAvLyBzdGFnZTogaXRzIHN0ZGluIGNvbWVzIGZyb20gdGhlIGhlcmVkb2MgYm9keSwgYW5kIGNvbnN1bWVycyB0aGF0XG4gICAgICAgICAgLy8gcmVhZCBgPGAgZnJvbSB0aGUgdGV4dCB3b3VsZCBvdGhlcndpc2UgbmV2ZXIgc2VlIHRoZSByZWRpcmVjdC5cbiAgICAgICAgICBidWZIZXJlZG9jID0gdHJ1ZTtcbiAgICAgICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgICAgIC8vIEluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCB0aGUgb3BlcmF0b3IrZGVsaW1pdGVyIHN0YXkgaW4gdGhlXG4gICAgICAgICAgICAvLyBzdGFnZSB0ZXh0IFx1MjAxNCB0aGUgd2FsaydzIGludGVyaW9yIHJlLXNwbGl0IHJlLXJlY29nbml6ZXMgdGhlXG4gICAgICAgICAgICAvLyBoZXJlZG9jIHRoZXJlIChwbGFuIFx1MDBBNzMpLlxuICAgICAgICAgICAgYnVmICs9IGNtZC5zbGljZShpLCBqKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaSA9IGo7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFdoaWxlIGEgY29uc3RydWN0IGlzIG9wZW4gYXQgZGVwdGggMCB0aGUgYm91bmRhcnkgb3BlcmF0b3JzIGFyZSB0ZXh0IFx1MjAxNFxuICAgICAgLy8gdGhlIGNvbnN0cnVjdCBpcyBvbmUgc3RhZ2UuXG4gICAgICBpZiAoY2FzZVJlZ2lvbiA9PT0gbnVsbCAmJiBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnYW5kJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdvcicpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3wmJykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgncGlwZScpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdzZW1pY29sb24nKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgncGlwZScpO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgICAvLyBBIG5ld2xpbmUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiBcdTIwMTQgbm90IGEgc3RhdGVtZW50IHNlcGFyYXRvciBcdTIwMTQgd2hlblxuICAgICAgICAgIC8vIGEgcGlwZS9hbmQvb3Igb3BlcmF0b3IgaXMgcGVuZGluZyB3aXRoIGEgd2hpdGVzcGFjZS1vbmx5IGJ1ZmZlclxuICAgICAgICAgIC8vIHNpbmNlIGl0IChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCwgYGZhbHNlICYmXFxuc2VkIC4uLmApLiBgY2F0IGYgfCBoZWFkIC0xXFxuY2F0IGdgXG4gICAgICAgICAgLy8gaXMgdGhlcmVmb3JlIHR3byBsaXN0cywgYW5kIGEgcmVkaXJlY3QgdGFyZ2V0IG5ldmVyIGNvbnRpbnVlcyBvbnRvXG4gICAgICAgICAgLy8gYSBsYXRlciBsaW5lIChwbGFuIFx1MDBBNzEpLlxuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnbmV3bGluZScpO1xuICAgICAgICAgIGxpc3RTdGFydCA9IHBhcnRzLmxlbmd0aDtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgICAgIC8vIEEgYmFyZSBgJmAgaXMgYSBiYWNrZ3JvdW5kIG9wZXJhdG9yIG9ubHkgd2hlbiBpdCBpcyBub3QgcGFydCBvZiBhXG4gICAgICAgICAgLy8gcmVkaXJlY3QgdG9rZW46IHRoZSBuZXh0IGNoYXJhY3RlciBpcyBgPmAgKGAmPmAvYCY+PmApLCBvciB0aGVcbiAgICAgICAgICAvLyBidWZmZXIncyBsYXN0IGNoYXJhY3RlciBpcyBgPmAgb3IgYDxgIChgMj4mMWAsIGA+JiBmaWxlYCwgYDM8JjBgKS5cbiAgICAgICAgICAvLyBTcGxpdHRpbmcgaW5zaWRlIHRob3NlIHRva2VucyB3b3VsZCBwcm9kdWNlIGp1bmsgc3RhZ2VzLiBBIGA+YFxuICAgICAgICAgIC8vIGNvdW50cyBhcyBhIGR1cC1yZWRpcmVjdCBwcmVmaXggb25seSBhdCBhIHRva2VuIGJvdW5kYXJ5IChzdGFydCxcbiAgICAgICAgICAvLyBvciBhZnRlciB3aGl0ZXNwYWNlL2RpZ2l0cykgXHUyMDE0IGBhPmImY2Agc3RpbGwgYmFja2dyb3VuZHMgdGhlXG4gICAgICAgICAgLy8gYGE+YmAgcmVkaXJlY3QuXG4gICAgICAgICAgY29uc3QgbmV4dCA9IGNtZFtpICsgMV07XG4gICAgICAgICAgY29uc3QgbGFzdCA9IGJ1ZltidWYubGVuZ3RoIC0gMV07XG4gICAgICAgICAgY29uc3QgdHJpbW1lZCA9IGJ1Zi50cmltRW5kKCk7XG4gICAgICAgICAgbGV0IGR1cFJlZGlyZWN0ID0gZmFsc2U7XG4gICAgICAgICAgaWYgKHRyaW1tZWQuZW5kc1dpdGgoJz4nKSkge1xuICAgICAgICAgICAgY29uc3QgYmVmb3JlID0gdHJpbW1lZC5sZW5ndGggPj0gMiA/IHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA6ICcnO1xuICAgICAgICAgICAgZHVwUmVkaXJlY3QgPSB0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdChiZWZvcmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobmV4dCA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0IHx8IGxhc3QgPT09ICc8Jykge1xuICAgICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdiYWNrZ3JvdW5kJyk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIC8vIEVuZCBvZiBpbnB1dDogdGhlIEVPRi1zdGF0ZSB2ZXJkaWN0cyBcdTIwMTQgYW4gdW5jbG9zZWQgcXVvdGUsIGJyYWNlLCBjYXNlXG4gIC8vIHJlZ2lvbiwgcGFyZW4gbGV2ZWwsIG9yIGNvbnN0cnVjdCBcdTIwMTQgdGhlbiB0aGUgdW5jb25zdW1lZC1vcGVyYXRvciBjaGVja3MsXG4gIC8vIHRoZW4gdGhlIHVudGVybWluYXRlZC1oZXJlZG9jIHBhcnRpYWwsIHRoZW4gdGhlIGZpbmFsIGZsdXNoLiBBIHZlcmRpY3RcbiAgLy8gc2V0IG1pZC1zY2FuIGFscmVhZHkgZHJvcHBlZCB0aGUgcmVqZWN0aW5nIGxpc3QgYW5kIGVuZGVkIHRoZSBsb29wLCBzb1xuICAvLyBgcGFydHNgIGlzIGV4YWN0bHkgdGhlIGNvbXBsZXRlZCBlYXJsaWVyIGxpc3RzIGhlcmUuXG4gIGlmIChtYWxmb3JtZWQpIHJldHVybiB7IHN0YWdlczogcGFydHMsIG1hbGZvcm1lZCB9O1xuICBpZiAoaW5TcXVvdGUgfHwgaW5EcXVvdGUpIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLXF1b3RlJyk7XG4gIH0gZWxzZSBpZiAoYnJhY2VEZXB0aCA+IDApIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLWJyYWNlJyk7XG4gIH0gZWxzZSBpZiAoY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY2FzZScpO1xuICB9IGVsc2UgaWYgKGRlcHRoID4gMCkge1xuICAgIHJlamVjdCgndW5iYWxhbmNlZC1wYXJlbicpO1xuICB9IGVsc2UgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCkge1xuICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gIH0gZWxzZSBpZiAoaXNVbmNvbnN1bWVkT3BlcmF0b3IoKSB8fCBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpKSB7XG4gICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICB9IGVsc2UgaWYgKGluQm9keSB8fCBoZXJlZG9jcy5sZW5ndGggPiAwKSB7XG4gICAgLy8gVW50ZXJtaW5hdGVkIGhlcmVkb2MgXHUyMDE0IGJhc2ggd2FybnMsIHJ1bnMgdGhlIGRlbGltaXRlcidzIGxpbmUsIGFuZFxuICAgIC8vIHRyZWF0cyB0aGUgdGFpbCBhcyBib2R5OiB0aGUgcGFydGlhbC4gVGhlIGRlbGltaXRlcidzLWxpbmUgc3RhZ2UocylcbiAgICAvLyBhbmFseXplIGFzLWlzOyB0aGUgYm9keSBwcm9kdWNlcyBubyBzdGFnZXMgKHBsYW4gXHUwMEE3MykuXG4gICAgZmx1c2goJ25ld2xpbmUnKTtcbiAgICBtYWxmb3JtZWQgPSAndW50ZXJtaW5hdGVkLWhlcmVkb2MnO1xuICB9IGVsc2Uge1xuICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gIH1cbiAgcmV0dXJuIHsgc3RhZ2VzOiBwYXJ0cywgbWFsZm9ybWVkIH07XG59XG5cbmNvbnN0IExFQURJTkdfQVNTSUdOTUVOVCA9IC9eKD86W0EtWmEtel9dW0EtWmEtejAtOV9dKj1cXFMqXFxzKykrLztcblxuLyoqIFN0cmlwIGxlYWRpbmcgRk9PPWJhciBWQVI9YmF6IGVudi1wcmVmaXggYXNzaWdubWVudHMgZnJvbSBhIHNpbXBsZSBjb21tYW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNpbXBsZUNtZC5yZXBsYWNlKExFQURJTkdfQVNTSUdOTUVOVCwgJycpO1xufVxuXG4vKiogT25lIHF1b3RlLWF3YXJlIGxleGljYWwgdG9rZW4gZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgdGV4dCAocGxhbiBcdTAwQTc1LjEwKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9rZW4ge1xuICAvKipcbiAgICogVGhlIHRva2VuIHRleHQuIFdvcmQgdG9rZW5zIGhhdmUgcXVvdGVzIHN0cmlwcGVkIGFuZCBlc2NhcGVzIHJlc29sdmVkO1xuICAgKiByZWRpcmVjdCB0b2tlbnMga2VlcCB0aGUgb3BlcmF0b3Igd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IChgPmZgLFxuICAgKiBgPj5mYCksIHNoZWxsLWxleGVyIHN0eWxlLlxuICAgKi9cbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gd2FzIHF1b3RlZCBvciBlc2NhcGVkIGFueXdoZXJlIGluIHRoZSBzb3VyY2UuIEEgcXVvdGVkXG4gICAqIHRva2VuIGlzIGEgd29yZCwgbmV2ZXIgYW4gb3BlcmF0b3IgKGBlY2hvICc+J2AgaXMgbm90IGEgcmVkaXJlY3QpLlxuICAgKi9cbiAgcXVvdGVkOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gaXMgYSByZWRpcmVjdCBvcGVyYXRvciAoYD5gLCBgPj5gLCBgMT5gLCBgMj5gLCBgJj5gLFxuICAgKiBgJj4+YCwgYD4mYCwgYDxgLCBgPDxgLCBgPDwtYCwgYDw8PGApLCB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgcHJlc2VydmVkXG4gICAqIGluIGB0ZXh0YC5cbiAgICovXG4gIGlzUmVkaXJlY3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgdG9rZW5pemVyIHRoYXQgc3BsaXRzIHJlZGlyZWN0IG9wZXJhdG9ycyBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aFxuICogYXR0YWNoZWQtdGFyZ2V0IGZvcm1zIHByZXNlcnZlZCAocGxhbiBcdTAwQTc1LjEwKS4gV29yZCB0b2tlbnMgY2FycnkgdGhlXG4gKiBgcXVvdGVkYCBmbGFnIHNvIGNvbnN1bWVycyBjYW4gdGVsbCBhIHJlYWwgYDw8YCBvcGVyYXRvciBmcm9tIGEgcXVvdGVkXG4gKiBgXCI8PFwiYCBsaXRlcmFsLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbml6ZShzOiBzdHJpbmcpOiBUb2tlbltdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VuczogVG9rZW5bXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gcy5sZW5ndGg7XG5cbiAgY29uc3QgZmx1c2hXb3JkID0gKCk6IHZvaWQgPT4ge1xuICAgIGlmIChidWYubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYsIHF1b3RlZCwgaXNSZWRpcmVjdDogZmFsc2UgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgdW5xdW90ZWQgY29udGVudCBvZiB0aGUgcXVvdGVkIHNlY3Rpb24gb3BlbmluZyBhdCBgc3RhcnRgXG4gICAqICh0aGUgcXVvdGUgY2hhcikgdG8gYG91dGAsIG1pcnJvcmluZyBzaGxleCdzIGVzY2FwZSBydWxlcyBmb3IgZG91YmxlXG4gICAqIHF1b3Rlcy4gUmV0dXJucyB0aGUgaW5kZXggYWZ0ZXIgdGhlIGNsb3NpbmcgcXVvdGUsIG9yIG51bGwgd2hlblxuICAgKiB1bmJhbGFuY2VkLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kUXVvdGVkQ29udGVudCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgY29uc3QgcXVvdGUgPSBzW3N0YXJ0XTtcbiAgICBsZXQgaiA9IHN0YXJ0ICsgMTtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKHF1b3RlID09PSBcIidcIikge1xuICAgICAgICBpZiAoYyA9PT0gXCInXCIpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGogKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaiArIDFdKSkge1xuICAgICAgICBvdXQgKz0gc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHJhdyBhdHRhY2hlZC10YXJnZXQgdGV4dCBzdGFydGluZyBhdCBgc3RhcnRgIHRvIGBvdXRgIFx1MjAxNFxuICAgKiB2ZXJiYXRpbSwgcXVvdGVkIHNlY3Rpb25zIHNwYW5uaW5nIHNwYWNlcyBpbmNsdWRlZCBcdTIwMTQgc3RvcHBpbmcgYXRcbiAgICogd2hpdGVzcGFjZSBvciBhbm90aGVyIHJlZGlyZWN0IG9wZXJhdG9yLiBSZXR1cm5zIHRoZSBuZXh0IGluZGV4LCBvciBudWxsXG4gICAqIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kQXR0YWNoZWRUYXJnZXQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBqID0gc3RhcnQ7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpIHx8IGMgPT09ICc8JyB8fCBjID09PSAnPicpIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoJycsIGopO1xuICAgICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICAgIG91dCArPSBzLnNsaWNlKGosIHNlY3Rpb24ubmV4dCk7XG4gICAgICAgIGogPSBzZWN0aW9uLm5leHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4pIHtcbiAgICAgICAgb3V0ICs9IGMgKyBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgfTtcblxuICAvKiogRW1pdCBhIHJlZGlyZWN0IHRva2VuIHdob3NlIHRleHQgcHJlZml4ZXMgdGhlIG9wZXJhdG9yIHdpdGggdGhlIGN1cnJlbnQgZGlnaXQgYnVmZmVyIChhbiBJT19OVU1CRVIgbGlrZSBgMj5gKS4gKi9cbiAgY29uc3QgZW1pdFJlZGlyZWN0ID0gKG9wZXJhdG9yOiBzdHJpbmcsIGF0dGFjaGVkU3RhcnQ6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGF0dGFjaGVkID0gYXBwZW5kQXR0YWNoZWRUYXJnZXQoJycsIGF0dGFjaGVkU3RhcnQpO1xuICAgIGlmIChhdHRhY2hlZCA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmICsgb3BlcmF0b3IgKyBhdHRhY2hlZC5vdXQsIHF1b3RlZDogZmFsc2UsIGlzUmVkaXJlY3Q6IHRydWUgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gICAgaSA9IGF0dGFjaGVkLm5leHQ7XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoYnVmLCBpKTtcbiAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgIGJ1ZiA9IHNlY3Rpb24ub3V0O1xuICAgICAgaSA9IHNlY3Rpb24ubmV4dDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnIHx8IGMgPT09ICc+Jykge1xuICAgICAgLy8gQSBgPGAvYD5gIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgYXQgYSB3b3JkIGJvdW5kYXJ5LCBvciBhZnRlciBhblxuICAgICAgLy8gSU9fTlVNQkVSIGRpZ2l0IHJ1biAoYDE+YCwgYDI+YCk7IG1pZC13b3JkIGl0IGVuZHMgdGhlIGN1cnJlbnQgd29yZFxuICAgICAgLy8gZmlyc3QgKGBlY2hvIGE+YmAgXHUyMTkyIHdvcmRzIGBlY2hvYCwgYGFgOyByZWRpcmVjdCBgPmJgKS5cbiAgICAgIGlmIChidWYgIT09ICcnICYmICEvXlxcZCskLy50ZXN0KGJ1ZikpIGZsdXNoV29yZCgpO1xuICAgICAgbGV0IG9wZXJhdG9yOiBzdHJpbmc7XG4gICAgICBpZiAoYyA9PT0gJzwnKSB7XG4gICAgICAgIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8PCcpIG9wZXJhdG9yID0gJzw8PCc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDwtJykgb3BlcmF0b3IgPSAnPDwtJztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMikgPT09ICc8PCcpIG9wZXJhdG9yID0gJzw8JztcbiAgICAgICAgZWxzZSBvcGVyYXRvciA9ICc8JztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMikgPT09ICc+PicgPyAnPj4nIDogJz4nO1xuICAgICAgfVxuICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIFx1MjAxNCB0aGUgc3Rkb3V0K3N0ZGVyciByZWRpcmVjdCAoa2VwdCB0b2dldGhlciBieVxuICAgICAgLy8gc3BsaXRUb3BMZXZlbCkuIEEgYmFyZSBgJmAgaGVyZSBpcyBhbiBvcmRpbmFyeSB3b3JkIGNoYXIgKGAmMWAgaW5cbiAgICAgIC8vIGAyPiYxYCwgd2hpY2ggdGhlIGF0dGFjaGVkLXRhcmdldCBzY2FuIGFib3ZlIGNvbnN1bWVkIGFueXdheSkuXG4gICAgICBpZiAoc1tpICsgMV0gPT09ICc+Jykge1xuICAgICAgICBmbHVzaFdvcmQoKTtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAzKSA9PT0gJyY+PicgPyAnJj4+JyA6ICcmPic7XG4gICAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGZsdXNoV29yZCgpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKipcbiAqIFRoZSBhdHRhY2hlZCB0YXJnZXQgb2YgYSByZWRpcmVjdCB0b2tlbiwgb3IgbnVsbCB3aGVuIHRoZSBvcGVyYXRvciBpc1xuICogc3RhbmRhbG9uZSAoYD5gIHZzIGA+ZmA7IGAyPmAgdnMgYDI+JjFgKS4gU3BsaXRzIGFuIG9wdGlvbmFsIElPX05VTUJFUlxuICogZGlnaXQgcnVuIG9mZiB0aGUgZnJvbnQsIHRoZW4gdGhlIG9wZXJhdG9yLCBsZWF2aW5nIHRoZSB0YXJnZXQuXG4gKi9cbmZ1bmN0aW9uIHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodGV4dDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdGV4dC5tYXRjaCgvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvKTtcbiAgaWYgKG1hdGNoID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgLCAsIHJlc3RdID0gbWF0Y2g7XG4gIHJldHVybiByZXN0Lmxlbmd0aCA+IDAgPyByZXN0IDogbnVsbDtcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHRva2VucyBtaW51cyByZWRpcmVjdCBvcGVyYXRvcnMgYW5kIHRoZWlyIHRhcmdldHMuIFJldHVybnMgbnVsbCBpZiB0aGUgY29tbWFuZCBkb2Vzbid0IHRva2VuaXplIGNsZWFubHkgKHVuYmFsYW5jZWQgcXVvdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcmd2T2Yoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEEgc3RhbmRhbG9uZSByZWRpcmVjdCBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0O1xuICAgIC8vIGFuIGF0dGFjaGVkIGZvcm0gKGA+ZmAsIGA+PmZgKSBpcyBzZWxmLWNvbnRhaW5lZC5cbiAgICBpZiAocmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0b2tlbi50ZXh0KSA9PT0gbnVsbCkgaSArPSAxO1xuICB9XG4gIHJldHVybiBhcmd2O1xufVxuXG4vKiogUXVvdGUtYXdhcmUgd2hpdGVzcGFjZSB0b2tlbml6ZXIsIHJvdWdobHkgbWF0Y2hpbmcgYHNobGV4LnNwbGl0KHMsIHBvc2l4PVRydWUpYC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0V29yZHMoczogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3Qgd29yZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXIgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB3b3Jkcy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb25zdCBlbmQgPSBzLmluZGV4T2YoXCInXCIsIGkpO1xuICAgICAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgY3VyICs9IHMuc2xpY2UoaSwgZW5kKTtcbiAgICAgIGkgPSBlbmQgKyAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHNbaV0gIT09ICdcIicpIHtcbiAgICAgICAgaWYgKHNbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2kgKyAxXSkpIHtcbiAgICAgICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN1ciArPSBzW2ldO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBjdXIgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaGFzID0gdHJ1ZTtcbiAgICBjdXIgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgaWYgKGhhcykgd29yZHMucHVzaChjdXIpO1xuICByZXR1cm4gd29yZHM7XG59XG5cbi8qKlxuICogV2hldGhlciBhbiBVTlFVT1RFRCBgPGAgXHUyMDE0IGEgc3RkaW4gcmVkaXJlY3QsIHN0YW5kYWxvbmUgKGA8IGZpbGVgKSBvciBnbHVlZFxuICogaW5zaWRlIGEgdG9rZW4gKGBoZWFkIC0yPGZgLCBgcmcgbmVlZGxlPGZgLCBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSBsaWtlXG4gKiBgLWUgbmVlZGxlPGZgKSBcdTIwMTQgYXBwZWFycyBpbiBhIHNpbXBsZSBjb21tYW5kLiBCYXNoIHRyZWF0cyBgPGAgYXMgYSByZWRpcmVjdFxuICogb3BlcmF0b3Igb25seSBvdXRzaWRlIHF1b3Rlcywgc28gdGhlIHNjYW4gaXMgcXVvdGUtYXdhcmU6IGEgbGl0ZXJhbCBgPGAgaW5cbiAqIGEgcGF0dGVybiBsaWtlIGByZyAtbiAnPGRpdj4nYCBvciBhbiBhd2sgc2NyaXB0IGxpa2UgYCdOUjw9MidgIG11c3QgbmV2ZXJcbiAqIGJlIG1pc3Rha2VuIGZvciBhIHJlZGlyZWN0LiBQcm9jZXNzIHN1YnN0aXR1dGlvbiBgPChcdTIwMjYpYCBhbmQgaGVyZS1zdHJpbmdzXG4gKiBgPDw8YCBhbHNvIGJlZ2luIHdpdGggYW4gdW5xdW90ZWQgYDxgIFx1MjAxNCBib3RoIGNvdW50IGFzIHJlZGlyZWN0cyBoZXJlIChmYWlsXG4gKiBjbG9zZWQ7IGEgcmVhZC10b3VjaCBiaW4gbmV2ZXIgbGVnaXRpbWF0ZWx5IG5lZWRzIHRoZW0pLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaGFzVW5xdW90ZWRSZWRpcmVjdChzaW1wbGVDbWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ21kLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IHNpbXBsZUNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIC8vIE5vIGVzY2FwZXMgaW5zaWRlIHNpbmdsZSBxdW90ZXMgXHUyMDE0IHRoZSBuZXh0IGAnYCBhbHdheXMgY2xvc2VzLlxuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgLy8gSW5zaWRlIGRvdWJsZSBxdW90ZXMgYSBiYWNrc2xhc2ggb25seSBlc2NhcGVzIGBcImAsIGBcXGAsIGAkYCwgYW5kXG4gICAgICAvLyBiYWNrdGljazsgZXZlcnl0aGluZyBlbHNlIChpbmNsdWRpbmcgYDxgKSBpcyBsaXRlcmFsLlxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IHNpbXBsZUNtZC5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzaW1wbGVDbWRbaSArIDFdKSkge1xuICAgICAgICBpICs9IDE7XG4gICAgICB9IGVsc2UgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgICAgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBzaW1wbGVDbWQubGVuZ3RoKSB7XG4gICAgICAvLyBBbiBlc2NhcGVkIGNoYXJhY3RlciBpcyBsaXRlcmFsIFx1MjAxNCBgXFw8YCBpcyBub3QgYSByZWRpcmVjdC5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogUmVkaXJlY3Qgb3BlcmF0b3JzIHRoYXQgZHJvcCB0b2dldGhlciB3aXRoIHRoZWlyIHBsYWluIHRhcmdldCB3b3JkIChwbGFuIFx1MDBBNzRcbiAqIHR3by10b2tlbiBzaGFwZXMpOiBgPmAsIGA+PmAsIGA8YCwgYDw+YCwgYCY+YCwgYCY+PmAsIGFuZCBkaWdpdC1wcmVmaXhlZFxuICogZm9ybXMgbGlrZSBgMj5gL2AyPj5gL2AzPGAuIGA+fGAgaXMgZGVsaWJlcmF0ZWx5IGFic2VudCBcdTIwMTQgaXQgZmFpbHMgY2xvc2VkLlxuICovXG5jb25zdCBSRURJUkVDVF9UV09fVE9LRU4gPSAvXig/Oj4+P3w8Pnw8fCY+Pj98WzAtOV0rKD86Pj4/fDw+fDwpKSQvO1xuXG4vKiogRHVwIGZvcm1zIHRoYXQgZHJvcCBhbG9uZSAocGxhbiBcdTAwQTc0KTogYDI+JjFgLCBgPiYtYCwgYDM8JjBgLiAqL1xuY29uc3QgUkVESVJFQ1RfRFVQID0gL14oPzpbMC05XSspP1s8Pl0mKD86WzAtOV0rfC0pJC87XG5cbi8qKiBGdXNlZCBvcGVyYXRvcit0YXJnZXQgd29yZHMgdGhhdCBkcm9wIHdob2xlIChwbGFuIFx1MDBBNzQpOiBgPm91dGAsIGAyPmVycmAsIGAmPm91dGAuICovXG5jb25zdCBSRURJUkVDVF9GVVNFRCA9IC9eKD86Pj4/fDw+fDx8Jj4+P3xbMC05XSsoPzo+Pj98PD58PCkpW148PiZ8XS87XG5cbi8qKiBIZXJlZG9jL2hlcmUtc3RyaW5nIG9wZXJhdG9ycyB3aXRoIGEgc2VwYXJhdGUgdGFyZ2V0IHdvcmQ6IGA8PGAsIGA8PC1gLCBgPDw8YC4gKi9cbmNvbnN0IEhFUkVET0NfVFdPX1RPS0VOID0gL14oPzo8PC0/fDw8PCkkLztcblxuLyoqIEZ1c2VkIGhlcmVkb2Mgd29yZHMgKHBsYW4gXHUwMEE3NCk6IGA8PEVPRmAsIGA8PC1FT0ZgLCBgPDw8eGAuICovXG5jb25zdCBIRVJFRE9DX0ZVU0VEID0gL14oPzo8PC0/fDw8PClbXjw+JnxdLztcblxuLyoqIFdoZXRoZXIgYSB3b3JkIGlzIGl0c2VsZiBhIHJlZGlyZWN0IHRva2VuIFx1MjAxNCBuZXZlciBhIHZhbGlkIHJlZGlyZWN0IHRhcmdldC4gKi9cbmNvbnN0IFJFRElSRUNUX1RPS0VOID0gKHc6IHN0cmluZyk6IGJvb2xlYW4gPT5cbiAgUkVESVJFQ1RfVFdPX1RPS0VOLnRlc3QodykgfHxcbiAgUkVESVJFQ1RfRFVQLnRlc3QodykgfHxcbiAgUkVESVJFQ1RfRlVTRUQudGVzdCh3KSB8fFxuICBIRVJFRE9DX1RXT19UT0tFTi50ZXN0KHcpIHx8XG4gIEhFUkVET0NfRlVTRUQudGVzdCh3KTtcblxuLyoqXG4gKiBTdHJpcCByZWRpcmVjdCB0b2tlbnMgZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgYXJndiBzbyB0aGUgcmVhZC1zaWRlXG4gKiBtYXRjaGVycyBzZWUgdGhlIHdvcmRzIHRoYXQgd2VyZSBhY3R1YWxseSByZWFkIChwbGFuIFx1MDBBNzQpOiB0d28tdG9rZW5cbiAqIG9wZXJhdG9ycyAoYD5gLCBgPj5gLCBgPGAsIGA8PmAsIGAmPmAsIGAmPj5gLCBkaWdpdC1wcmVmaXhlZCBgMj5gL2AyPj5gL1xuICogYDM8YCwgLi4uKSBkcm9wIHRvZ2V0aGVyIHdpdGggdGhlaXIgcGxhaW4gdGFyZ2V0IHdvcmQsIGR1cCBmb3JtcyAoYDI+JjFgLFxuICogYD4mLWAsIGAzPCYwYCkgZHJvcCBhbG9uZSwgZnVzZWQgZm9ybXMgKGA+b3V0YCwgYDI+ZXJyYCwgYCY+b3V0YCkgZHJvcCBhc1xuICogb25lIHdvcmQsIGFuZCBoZXJlZG9jL2hlcmUtc3RyaW5nIG9wZXJhdG9ycyBkcm9wIHdpdGggdGhlaXIgdGFyZ2V0IHdvcmQgaW5cbiAqIGJvdGggc3BlbGxpbmdzLiBBIHR3by10b2tlbiBvcGVyYXRvcidzIHRhcmdldCBtdXN0IGJlIGEgcGxhaW4gZmlsZSB3b3JkIFx1MjAxNCBhXG4gKiBmb2xsb3dpbmcgcmVkaXJlY3QgdG9rZW4gKGBjYXQgZiA+IDI+JjFgKSBpcyBiYXNoJ3MgXCJzeW50YXggZXJyb3IgbmVhclxuICogdW5leHBlY3RlZCB0b2tlblwiIGFuZCBsZWF2ZXMgdGhlIG9wZXJhdG9yIGRhbmdsaW5nLCB1bm1hdGNoZWQuIEFueXRoaW5nXG4gKiBlbHNlIGJlZ2lubmluZyB3aXRoIGA+YC9gPGAgKG5vdGFibHkgYD58YCkgaXMgbGVmdCBhbG9uZSBcdTIwMTQgdGhlIGNhbGxlclxuICogdHJlYXRzIGEgcmVzaWR1YWwgcmVkaXJlY3Qgd29yZCBhcyBhbiB1bm1hdGNoZWQgc3RhZ2UuIEFwcGxpZWQgdG8gZXZlcnlcbiAqIHN0YWdlIFx1MjAxNCBzb3VyY2VzLCBzZWxlY3RvcnMsIGFuZCBwcmVkaWNhdGVzIFx1MjAxNCBiZWZvcmUgc3RhdHVzIGV2YWx1YXRpb24gYW5kXG4gKiBtYXRjaGVyIGRpc3BhdGNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBSZWRpcmVjdHMoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKFJFRElSRUNUX1RXT19UT0tFTi50ZXN0KGEpIHx8IEhFUkVET0NfVFdPX1RPS0VOLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICAgIC8vIFRoZSBvcGVyYXRvcidzIHRhcmdldCBtdXN0IGJlIGEgcGxhaW4gZmlsZSB3b3JkIFx1MjAxNCBhIGZvbGxvd2luZyByZWRpcmVjdFxuICAgICAgLy8gdG9rZW4gbWVhbnMgdGhlIG9wZXJhdG9yIGRhbmdsZXMgYW5kIHRoZSBjb21tYW5kIG5ldmVyIHJ1bnMuIFRoZVxuICAgICAgLy8gZGFuZ2xpbmcgb3BlcmF0b3IgaXRzZWxmIGlzIGxlZnQgaW4gcGxhY2Ugc28gdGhlIGNhbGxlciByZWplY3RzIHRoZVxuICAgICAgLy8gc3RhZ2UgYXMgdW5tYXRjaGVkLlxuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhUkVESVJFQ1RfVE9LRU4obmV4dCkpIHtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0LnB1c2goYSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFJFRElSRUNUX0RVUC50ZXN0KGEpIHx8IFJFRElSRUNUX0ZVU0VELnRlc3QoYSkgfHwgSEVSRURPQ19GVVNFRC50ZXN0KGEpKSBjb250aW51ZTtcbiAgICBvdXQucHVzaChhKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU2hlbGwgYnVpbHRpbnMgdGhlIHdhbGsgcmVjb2duaXplcyBhIGBidWlsdGluYCB3cmFwcGVyIG1heSBmb3J3YXJkIChwbGFuIFx1MDBBNzUpLiAqL1xuY29uc3QgV1JBUFBFUl9CVUlMVElOUyA9IG5ldyBTZXQoW1xuICAnZXhpdCcsXG4gICdleGVjJyxcbiAgJ3RydWUnLFxuICAnZmFsc2UnLFxuICAnOicsXG4gICdjZCcsXG4gICdzZXQnLFxuICAndW5zZXQnLFxuICAnZXhwb3J0JyxcbiAgJ3JlYWRvbmx5JyxcbiAgJ3JldHVybicsXG4gICdicmVhaycsXG4gICdjb250aW51ZSdcbl0pO1xuXG4vKiogRXh0ZXJuYWxzIHdob3NlIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aHMgc3RyaXAgdG8gdGhlaXIgYmFzZW5hbWUgKHBsYW4gXHUwMEE3NSkuICovXG5jb25zdCBSRUNPR05JWkVEX0VYVEVSTkFMX05BTUVTID0gbmV3IFNldChbXG4gICdzZWQnLFxuICAnaGVhZCcsXG4gICd0YWlsJyxcbiAgJ2NhdCcsXG4gICdubCcsXG4gICdnaXQnLFxuICAndHJ1ZScsXG4gICdmYWxzZScsXG4gICd0aW1lb3V0JyxcbiAgJ2VudicsXG4gICdjb21tYW5kJ1xuXSk7XG5cbi8qKiBBIGB0aW1lb3V0YCBkdXJhdGlvbiB3b3JkOiBgNWAsIGA1LjVzYCwgYDFtYCwgYDJoYCwgLi4uICovXG5jb25zdCBUSU1FT1VUX0RVUkFUSU9OID0gL15cXGQrKD86XFwuXFxkKyk/W3NtaGRdPyQvO1xuXG4vKiogQSBsaXRlcmFsIGBOQU1FPXZhbHVlYCBlbnYtcHJlZml4IHdvcmQuICovXG5jb25zdCBFTlZfQVNTSUdOTUVOVCA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0uKiQvO1xuXG4vKipcbiAqIE9uZSBzdHJpcCBzdGVwLiBSZXR1cm5zIG51bGwgd2hlbiB0aGUgd3JhcHBlciBpcyBub3QgY2xlYW4gKGZhaWwgY2xvc2VkIFx1MjAxNFxuICogdGhlIGNhbGxlciByZXN0b3JlcyB0aGUgb3JpZ2luYWwgYXJndiwgc28gbm90aGluZyBpcyBmb3J3YXJkZWQgdG8gdGhlXG4gKiBtYXRjaGVycyksIG9yIHRoZSBhcmd2IHdpdGggb25lIHdyYXBwZXIgbGF5ZXIgcmVtb3ZlZC5cbiAqL1xuZnVuY3Rpb24gc3RyaXBXcmFwcGVyc09uY2UoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJyEnKSBpKys7XG4gIGlmIChpID49IGFyZ3YubGVuZ3RoKSByZXR1cm4gYXJndi5zbGljZShpKTtcbiAgY29uc3QgaGVhZCA9IGFyZ3ZbaV07XG4gIGlmIChoZWFkID09PSAnY29tbWFuZCcpIHtcbiAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgaWYgKG5leHQgPT09ICctdicgfHwgbmV4dCA9PT0gJy1WJykgcmV0dXJuIG51bGw7IC8vIGEgcXVlcnkgXHUyMDE0IHJ1bnMgbm90aGluZ1xuICAgIGlmIChuZXh0ID09PSAnLXAnKSByZXR1cm4gYXJndi5zbGljZShpICsgMik7XG4gICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhbmV4dC5zdGFydHNXaXRoKCctJykpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAxKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ2J1aWx0aW4nKSB7XG4gICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgV1JBUFBFUl9CVUlMVElOUy5oYXMobmV4dCkpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAyKTtcbiAgICByZXR1cm4gbnVsbDsgLy8gYGJ1aWx0aW4gc2VkYCBlcnJvcnMgXHUyMDE0IG5ldmVyIGZvcndhcmQgYSBub24tYnVpbHRpbiB3b3JkXG4gIH1cbiAgaWYgKGhlYWQgPT09ICdlbnYnKSB7XG4gICAgbGV0IGogPSBpICsgMTtcbiAgICB3aGlsZSAoaiA8IGFyZ3YubGVuZ3RoICYmIEVOVl9BU1NJR05NRU5ULnRlc3QoYXJndltqXSkpIGorKztcbiAgICBpZiAoaiA9PT0gaSArIDEpIHJldHVybiBudWxsOyAvLyBgLWlgLCBgLXUgWGAsIGEgbm9uLWFzc2lnbm1lbnQgd29yZCBcdTIwMTQgbm90IGEgY2xlYW4gd3JhcHBlclxuICAgIHJldHVybiBhcmd2LnNsaWNlKGopO1xuICB9XG4gIGlmIChoZWFkID09PSAndGltZW91dCcpIHtcbiAgICBsZXQgaiA9IGkgKyAxO1xuICAgIHdoaWxlIChqIDwgYXJndi5sZW5ndGggJiYgYXJndltqXS5zdGFydHNXaXRoKCctLScpKSBqKys7XG4gICAgaWYgKGogPj0gYXJndi5sZW5ndGggfHwgIVRJTUVPVVRfRFVSQVRJT04udGVzdChhcmd2W2pdKSkgcmV0dXJuIG51bGw7IC8vIG5vIGR1cmF0aW9uIFx1MjAxNCBub3RoaW5nIHJ1bnNcbiAgICByZXR1cm4gYXJndi5zbGljZShqICsgMSk7XG4gIH1cbiAgaWYgKGhlYWQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgY29uc3QgYmFzZSA9IGhlYWQuc2xpY2UoaGVhZC5sYXN0SW5kZXhPZignLycpICsgMSk7XG4gICAgaWYgKFJFQ09HTklaRURfRVhURVJOQUxfTkFNRVMuaGFzKGJhc2UpKSByZXR1cm4gW2Jhc2UsIC4uLmFyZ3Yuc2xpY2UoaSArIDEpXTtcbiAgICByZXR1cm4gbnVsbDsgLy8gYC91c3IvYmluL2V4aXRgIGFuZCBmcmllbmRzIGFyZSBub3QgcmVjb2duaXplZCBleHRlcm5hbHNcbiAgfVxuICBpZiAoaGVhZC5pbmNsdWRlcygnLycpKSByZXR1cm4gbnVsbDsgLy8gYSByZWxhdGl2ZSBjb2xsaWRpbmcgcGF0aCBpcyBhIGxvY2FsIGJpbmFyeSwgbm90IHRoZSBjb3JldXRpbFxuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqXG4gKiBTdHJpcCB0cmFuc3BhcmVudCB3cmFwcGVyIHByZWZpeGVzIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIGFyZ3Ygc28gbWF0Y2hlclxuICogZGlzcGF0Y2ggc2VlcyB0aGUgdW5kZXJseWluZyBjb21tYW5kIHdvcmQgKHBsYW4gXHUwMEE3NSk6IGBjb21tYW5kYCAoc3RvcHBpbmcgYXRcbiAqIHRoZSBxdWVyeSBmb3JtcyBgLXZgL2AtVmApLCBgYnVpbHRpbmAgcmVzdHJpY3RlZCB0byB0aGUgd2FsaydzIHJlY29nbml6ZWRcbiAqIGJ1aWx0aW5zLCBgZW52IE5BTUU9dmFsdWVgIHByZWZpeGVzLCBgdGltZW91dGAgcGx1cyBpdHMgYC0tKmAgZmxhZ3MgYW5kIG9uZVxuICogZHVyYXRpb24sIGFuZCBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGhzIHdob3NlIGJhc2VuYW1lIGlzIGluIHRoZSByZWNvZ25pemVkXG4gKiBzZXQgXHUyMDE0IGl0ZXJhdGluZyB1bnRpbCBmaXhlZC1wb2ludCBzbyBzdGFja2VkIHdyYXBwZXJzIHN0aWxsIHJlYWNoIHRoZSB3b3JkLlxuICogQW55IHVuY2xlYW4gd3JhcHBlciBmYWlscyBjbG9zZWQ6IHRoZSBvcmlnaW5hbCBhcmd2IGlzIHJldHVybmVkIHVuY2hhbmdlZCxcbiAqIHNvIHRoZSBzdGFnZSBtYXRjaGVzIG5vdGhpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcFdyYXBwZXJzKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBsZXQgY3VycmVudCA9IGFyZ3Y7XG4gIGZvciAobGV0IGl0ZXIgPSAwOyBpdGVyIDwgYXJndi5sZW5ndGggKyAyOyBpdGVyKyspIHtcbiAgICBjb25zdCBuZXh0ID0gc3RyaXBXcmFwcGVyc09uY2UoY3VycmVudCk7XG4gICAgaWYgKG5leHQgPT09IG51bGwpIHJldHVybiBhcmd2O1xuICAgIGlmIChuZXh0Lmxlbmd0aCA9PT0gY3VycmVudC5sZW5ndGggJiYgbmV4dC5ldmVyeSgodywgaykgPT4gdyA9PT0gY3VycmVudFtrXSkpIHJldHVybiBjdXJyZW50O1xuICAgIGN1cnJlbnQgPSBuZXh0O1xuICB9XG4gIHJldHVybiBhcmd2O1xufVxuIiwgIi8qKlxuICogVGhlIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAocGxhbiBcdTAwQTc1LjcpLCBzaWJsaW5nIHRvXG4gKiBtZWNoYW5pY2FsLWNoYW5nZS50cydzIHJhbmdlLWxlc3MgYHBhcnNlVW5pZmllZERpZmZgLiBUaGUgcGF0Y2gvZ2l0IGFwcGx5XG4gKiBncmFtbWFyIG5lZWRzIHRoZSBgQEAgLWEsYiArYyxkIEBAYCBodW5rIG51bWJlcnMgdGhhdCBwYXJzZVVuaWZpZWREaWZmXG4gKiBkaXNjYXJkcywgc28gdGhpcyBwYXJzZXMgdGhlIHNhbWUgaGVhZGVyIGRpYWxlY3QgZnJvbSBzY3JhdGNoLlxuICpcbiAqIEEgaHVuayB3aG9zZSBwcmUvcG9zdCBsaW5lIGNvdW50cyBtYXRjaCBwcmVzZXJ2ZXMgbGluZSBjb29yZGluYXRlcywgc28gYVxuICogZmlsZSB3aG9zZSBodW5rcyBhcmUgYWxsIGNvdW50LXByZXNlcnZpbmcgZ2V0cyBhbiBleGFjdCByYW5nZSBcdTIwMTQgdGhlIHVuaW9uIG9mXG4gKiBldmVyeSBodW5rJ3MgcmVnaW9uLiBBbnkgY291bnQtY2hhbmdpbmcgaHVuayAocHVyZSBhZGQsIHB1cmUgZGVsZXRlLCB1bmVxdWFsXG4gKiBjb3VudHMpIGRlZ3JhZGVzIHRoZSBmaWxlIHRvIGEgd2hvbGUtZmlsZSBtb2RpZnk6IHBvc2l0aW9ucyBiZWxvdyBpdCBzaGlmdCxcbiAqIGFuZCBhIGRlbGV0ZWQgbGluZSBvY2N1cGllcyBubyBwb3N0LWVkaXQgcmFuZ2UgYXQgYWxsLlxuICpcbiAqIFBlci1maWxlIGNsYXNzaWZpY2F0aW9uczogYG5ldyBmaWxlIG1vZGVgIFx1MjE5MiBjcmVhdGUtb3ZlcndyaXRlOyBgZGVsZXRlZCBmaWxlXG4gKiBtb2RlYCBcdTIxOTIgZGVsZXRlOyBgcmVuYW1lIGZyb21gL2ByZW5hbWUgdG9gIFx1MjE5MiBzb3VyY2UgZGVsZXRlICsgZGVzdFxuICogcmVuYW1lLWNvcHk7IGJpbmFyeSBkaWZmcyBcdTIxOTIgd2hvbGUtZmlsZSBtb2RpZnk7IGEgYCsrKyAvZGV2L251bGxgIHRhcmdldCAodGhlXG4gKiBzaGFwZSBgZGlmZiAtdWAtZm9ybWF0IGRlbGV0aW9ucyB0YWtlKSBcdTIxOTIgZGVsZXRlLCBhbmQgYSBgLS0tIC9kZXYvbnVsbGAgc2lkZVxuICogKHRoZSBgZGlmZiAtdWAtZm9ybWF0IGNyZWF0aW9uIHNoYXBlLCB3aXRoIG5vIGBuZXcgZmlsZSBtb2RlYCBoZWFkZXIpIFx1MjE5MlxuICogY3JlYXRlLW92ZXJ3cml0ZS5cbiAqXG4gKiBHaXQtc3R5bGUgYGEvXHUyMDI2YC9gYi9cdTIwMjZgIHByZWZpeGVzIGFyZSBzdHJpcHBlZCBwZXIgdGhlIGNhbGxlcidzIGAtcE5gIHN0cmlwXG4gKiBsZXZlbDogYSBudW1iZXIgc3RyaXBzIHRoYXQgbWFueSBsZWFkaW5nIHBhdGggY29tcG9uZW50cywgYW5kIGAnYXV0bydgXG4gKiAocGF0Y2gncyBkZWZhdWx0KSBzdHJpcHMgb25lIHdoZW4gdGhlIHBhdGggaXMgYS8tIG9yIGIvLXByZWZpeGVkIGFuZCBub25lXG4gKiBvdGhlcndpc2UuIGAvZGV2L251bGxgIGlzIGNoZWNrZWQgYmVmb3JlIHN0cmlwcGluZyBcdTIwMTQgdGhlIGhlYWRlciBtYXJrZXJcbiAqIHdvdWxkIG90aGVyd2lzZSBsb3NlIGl0cyBgZGV2L2AgY29tcG9uZW50LlxuICpcbiAqIGBkaWZmIC11YCBoZWFkZXJzIGNhcnJ5IGEgdGFiLXNlcGFyYXRlZCB0aW1lc3RhbXAgKGAtLS0gZi50eHRcXHQyMDI0LTAxLTAxXG4gKiAwMDowMDowMGApIGFuZCBtYXkgYmUgQ1JMRi10ZXJtaW5hdGVkOyBib3RoIGFyZSBzdHJpcHBlZCBiZWZvcmUgcGF0aFxuICogcmVzb2x1dGlvbi4gVGhlIHRhcmdldCBvZiBhIG1vZGlmeSBodW5rIGlzIHRoZSBgLS0tYCBzaWRlOiBwYXRjaCBhbmQgZ2l0XG4gKiBhcHBseSByZXdyaXRlIHRoZSBmaWxlIG5hbWVkIHRoZXJlIChmb3IgYGRpZmYgLXUgZi50eHQgZi5uZXdgLCB0aGUgYCsrK2BcbiAqIHNpZGUgaXMgb25seSBhIGxhYmVsKSwgc28gdGhlIGArKytgIGxpbmUgb3ZlcnJpZGVzIHRoZSBwYXRoIG9ubHkgZm9yIHRoZVxuICogYC9kZXYvbnVsbGAgbWFya2VycyBcdTIwMTQgYSBgLS0tIC9kZXYvbnVsbGAgc2lkZSAoYSBuZXcgZmlsZSkgbmFtZXMgdGhlIHRhcmdldFxuICogb24gYCsrK2AsIGFuZCBhIGArKysgL2Rldi9udWxsYCBzaWRlIG1hcmtzIGEgZGVsZXRpb24uXG4gKlxuICogTWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQgcmV0dXJucyBudWxsIChmYWlsIGNsb3NlZCBcdTIwMTQgdGhlIGNhbGxlciBlbWl0c1xuICogdW5yZXNvbHZlZCByYXRoZXIgdGhhbiBndWVzc2luZyBhdCB0YXJnZXRzKS5cbiAqL1xuXG4vKiogVGhlIGAtcE5gIGhlYWRlciBzdHJpcCBsZXZlbDogYSBjb21wb25lbnQgY291bnQsIG9yIHBhdGNoJ3MgYCdhdXRvJ2AgZGVmYXVsdC4gKi9cbmV4cG9ydCB0eXBlIFBhdGhTdHJpcCA9IG51bWJlciB8ICdhdXRvJztcblxuLyoqIE9uZSBmaWxlIGEgcGF0Y2ggdG91Y2hlczogdGhlIHRhcmdldCBwYXRoLCB0aGUgdG91Y2gga2luZCwgYW5kIHRoZSBleGFjdCByYW5nZSB3aGVuIHRoZSBodW5rcyBwcmVzZXJ2ZSBsaW5lIGNvdW50cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVW5pZmllZERpZmZUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG9wZXJhdGlvbjogJ21vZGlmeScgfCAnY3JlYXRlLW92ZXJ3cml0ZScgfCAnZGVsZXRlJyB8ICdyZW5hbWUtY29weSc7XG4gIGxpbmVTdGFydD86IG51bWJlcjtcbiAgbGluZUVuZD86IG51bWJlcjtcbn1cblxuY29uc3QgSFVOS19IRUFERVIgPSAvXkBAIC0oXFxkKykoPzosKFxcZCspKT8gXFwrKFxcZCspKD86LChcXGQrKSk/IEBALztcblxuLyoqIFN0cmlwIHRoZSBmaXJzdCBgbmAgbGVhZGluZyBwYXRoIGNvbXBvbmVudHMgKGAtcE5gKSwgc3RvcHBpbmcgYXQgYSBjb21wb25lbnQtbGVzcyBwYXRoLiAqL1xuZnVuY3Rpb24gc3RyaXBQYXRoQ29tcG9uZW50cyhwOiBzdHJpbmcsIG46IG51bWJlcik6IHN0cmluZyB7XG4gIGxldCBzID0gcDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCBzbGFzaCA9IHMuaW5kZXhPZignLycpO1xuICAgIGlmIChzbGFzaCA9PT0gLTEpIHJldHVybiBzO1xuICAgIHMgPSBzLnNsaWNlKHNsYXNoICsgMSk7XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbi8qKlxuICogVGhlIGxldmVsIHRvIHN0cmlwIGZyb20gYHJhd2AgdW5kZXIgYHN0cmlwYDogYSBudW1iZXIgcGFzc2VzIHRocm91Z2g7IGAnYXV0bydgXG4gKiByZXNvbHZlcyB0byBwMSB3aGVuIHRoZSBwYXRoIGlzIGBhL2AvYGIvYC1wcmVmaXhlZCBhbmQgcDAgb3RoZXJ3aXNlIFx1MjAxNCBwYXRjaCdzXG4gKiBkZWZhdWx0IGZvciBkaWZmcyB3aG9zZSBwcmVmaXhlcyBhcmUgYGRpZmYgLXVgLXN0eWxlIHJhdGhlciB0aGFuIGdpdCdzLlxuICovXG5mdW5jdGlvbiBzdHJpcExldmVsRm9yKHJhdzogc3RyaW5nLCBzdHJpcDogUGF0aFN0cmlwKTogbnVtYmVyIHtcbiAgcmV0dXJuIHN0cmlwID09PSAnYXV0bycgPyAocmF3LnN0YXJ0c1dpdGgoJ2EvJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ2IvJykgPyAxIDogMCkgOiBzdHJpcDtcbn1cblxuLyoqXG4gKiBUaGUgcmF3IGAtLS1gL2ArKytgIGhlYWRlciBwYXRoOiB0aGUgdGV4dCB1cCB0byB0aGUgZmlyc3QgdGFiICh0aGVcbiAqIGBkaWZmIC11YCB0aW1lc3RhbXAgY29sdW1uKSwgb3IgdGhlIHdob2xlIHdvcmQgd2hlbiB0aGVyZSBpcyBub25lLiBDUkxGXG4gKiBpcyBoYW5kbGVkIGF0IHRoZSBsaW5lIGxldmVsIChzZWUgcGFyc2VVbmlmaWVkRGlmZlJhbmdlKSwgd2hpY2ggYWxzb1xuICogY292ZXJzIGh1bmsgaGVhZGVycy5cbiAqL1xuZnVuY3Rpb24gaGVhZGVyUGF0aFRleHQocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0YWIgPSByYXcuaW5kZXhPZignXFx0Jyk7XG4gIHJldHVybiB0YWIgPT09IC0xID8gcmF3IDogcmF3LnNsaWNlKDAsIHRhYik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBVbmlmaWVkRGlmZlRhcmdldFtdIHwgbnVsbCB7XG4gIGNvbnN0IHJlc3VsdHM6IFVuaWZpZWREaWZmVGFyZ2V0W10gPSBbXTtcbiAgbGV0IHNhd0Jsb2NrID0gZmFsc2U7XG4gIGxldCBjdXJyZW50OiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGtpbmQ6ICdtb2RpZnknIHwgJ25ldycgfCAnZGVsZXRlZCc7XG4gICAgaHVua3M6IEFycmF5PHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfT47XG4gICAgY291bnRDaGFuZ2luZzogYm9vbGVhbjtcbiAgfSB8IG51bGwgPSBudWxsO1xuICBsZXQgcGVuZGluZ0tpbmQ6ICduZXcnIHwgJ2RlbGV0ZWQnIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVGcm9tOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZVRvOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGJpbmFyeSA9IGZhbHNlO1xuXG4gIC8qKiBUaGUgaGVhZGVyIHBhdGgsIHRhYi9DUi1zdHJpcHBlZCwgd2l0aCB0aGUgYC1wTmAgbGV2ZWwgYXBwbGllZCBcdTIwMTQgYC9kZXYvbnVsbGAga2VwdCB2ZXJiYXRpbSAodGhlIG1hcmtlciBpcyBuZXZlciBhIHJlYWwgcGF0aCkuICovXG4gIGNvbnN0IHN0cmlwcGVkID0gKHJhdzogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICBjb25zdCB0ZXh0ID0gaGVhZGVyUGF0aFRleHQocmF3KTtcbiAgICBpZiAodGV4dCA9PT0gJy9kZXYvbnVsbCcpIHJldHVybiB0ZXh0O1xuICAgIHJldHVybiBzdHJpcFBhdGhDb21wb25lbnRzKHRleHQsIHN0cmlwTGV2ZWxGb3IodGV4dCwgc3RyaXApKTtcbiAgfTtcblxuICBjb25zdCBmaW5pc2ggPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIHtcbiAgICAgIGlmIChjdXJyZW50LmtpbmQgPT09ICduZXcnKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5raW5kID09PSAnZGVsZXRlZCcpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnZGVsZXRlJyB9KTtcbiAgICAgIGVsc2UgaWYgKGJpbmFyeSkgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5odW5rcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gQSBoZWFkZXItb25seSBibG9jayB3aXRoIG5vIGh1bmtzOiBub3RoaW5nIHN0YXRpY2FsbHkga25vd24uXG4gICAgICB9IGVsc2UgaWYgKGN1cnJlbnQuY291bnRDaGFuZ2luZykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguc3RhcnQpKTtcbiAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguZW5kKSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kIH0pO1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IG51bGw7XG4gICAgfVxuICAgIGlmIChyZW5hbWVGcm9tICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVGcm9tLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgIGlmIChyZW5hbWVUbyAhPT0gbnVsbCkgcmVzdWx0cy5wdXNoKHsgcGF0aDogcmVuYW1lVG8sIG9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5JyB9KTtcbiAgICByZW5hbWVGcm9tID0gbnVsbDtcbiAgICByZW5hbWVUbyA9IG51bGw7XG4gICAgYmluYXJ5ID0gZmFsc2U7XG4gIH07XG5cbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIHBhdGNoVGV4dC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBBIHRyYWlsaW5nIGBcXHJgIChDUkxGIHBhdGNoIHRleHQgXHUyMDE0IFdpbmRvd3MtYXV0aG9yZWQgZGlmZnMpIHBvbGx1dGVzXG4gICAgLy8gaGVhZGVycywgaHVuayBoZWFkZXJzLCBhbmQgcGF0aCBsaW5lcyBhbGlrZTsgYm90aCBwYXRjaCBhbmQgZ2l0IGFwcGx5XG4gICAgLy8gc3RyaXAgaXQsIHNvIHRoZSBwYXJzZXIgZG9lcyB0b28uXG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUuZW5kc1dpdGgoJ1xccicpID8gcmF3TGluZS5zbGljZSgwLCAtMSkgOiByYXdMaW5lO1xuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJy0tLSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgY3VycmVudCA9IHtcbiAgICAgICAgcGF0aDogc3RyaXBwZWQobGluZS5zbGljZSg0KSksXG4gICAgICAgIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLFxuICAgICAgICBodW5rczogW10sXG4gICAgICAgIGNvdW50Q2hhbmdpbmc6IGZhbHNlXG4gICAgICB9O1xuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJysrKyAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgY29uc3QgcGF0aCA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpO1xuICAgICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIGN1cnJlbnQgPSB7IHBhdGgsIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLCBodW5rczogW10sIGNvdW50Q2hhbmdpbmc6IGZhbHNlIH07XG4gICAgICBlbHNlIGlmIChwYXRoID09PSAnL2Rldi9udWxsJykgY3VycmVudC5raW5kID0gJ2RlbGV0ZWQnO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5wYXRoID09PSAnL2Rldi9udWxsJykge1xuICAgICAgICAvLyBBIGAtLS0gL2Rldi9udWxsYCBzaWRlIHJlcGxhY2VkIGJ5IGEgcmVhbCBgKysrYCBwYXRoIGlzIGEgbmV3IGZpbGVcbiAgICAgICAgLy8gKHRoZSBgZGlmZiAtdWAtZm9ybWF0IGNyZWF0aW9uIHNoYXBlIFx1MjAxNCBubyBgbmV3IGZpbGUgbW9kZWAgaGVhZGVyKS5cbiAgICAgICAgLy8gSXRzIGBAQCAtMCwwICtOIEBAYCBodW5rIGhhcyBubyBwcmUtZWRpdCBsaW5lcywgc28gdGhlXG4gICAgICAgIC8vIGNyZWF0ZS1vdmVyd3JpdGUgaXMgZGVjaWRlZCBoZXJlLCBub3QgZnJvbSBodW5rIGNvdmVyYWdlLlxuICAgICAgICBjdXJyZW50LnBhdGggPSBwYXRoO1xuICAgICAgICBjdXJyZW50LmtpbmQgPSAnbmV3JztcbiAgICAgIH1cbiAgICAgIC8vIE90aGVyd2lzZSBrZWVwIHRoZSBgLS0tYCBzaWRlOiBwYXRjaCBhbmQgZ2l0IGFwcGx5IHJld3JpdGUgdGhlIGZpbGVcbiAgICAgIC8vIG5hbWVkIG9uIHRoZSBgLS0tYCBsaW5lLCBhbmQgYGRpZmYgLXUgZiBmLm5ld2AgaGVhZGVycyBuYW1lIHRoZVxuICAgICAgLy8gcHJlLWltYWdlIHRoZXJlIFx1MjAxNCB0aGUgYCsrK2AgcGF0aCBpcyBvbmx5IGEgbGFiZWwgKHRoZSBkaWZmLXV1XG4gICAgICAvLyBwYXRjaC1oZWFkZXIgbWlzcykuXG4gICAgICBwZW5kaW5nS2luZCA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnbmV3IGZpbGUgbW9kZScpKSB7XG4gICAgICBwZW5kaW5nS2luZCA9ICduZXcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2RlbGV0ZWQgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ2RlbGV0ZWQnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSBmcm9tICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkgZmluaXNoKCk7XG4gICAgICByZW5hbWVGcm9tID0gc3RyaXBwZWQobGluZS5zbGljZSgncmVuYW1lIGZyb20gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdyZW5hbWUgdG8gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIHJlbmFtZVRvID0gc3RyaXBwZWQobGluZS5zbGljZSgncmVuYW1lIHRvICcubGVuZ3RoKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnQmluYXJ5IGZpbGVzICcpIHx8IGxpbmUuc3RhcnRzV2l0aCgnR0lUIGJpbmFyeSBwYXRjaCcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBiaW5hcnkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGh1bmsgPSBsaW5lLm1hdGNoKEhVTktfSEVBREVSKTtcbiAgICBpZiAoaHVuaykge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgY29uc3QgcHJlU3RhcnQgPSBOdW1iZXIucGFyc2VJbnQoaHVua1sxXSwgMTApO1xuICAgICAgY29uc3QgcHJlQ291bnQgPSBodW5rWzJdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbMl0sIDEwKTtcbiAgICAgIGNvbnN0IHBvc3RDb3VudCA9IGh1bmtbNF0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1s0XSwgMTApO1xuICAgICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIHJldHVybiBudWxsOyAvLyBhIGh1bmsgd2l0aG91dCBhIGZpbGUgaGVhZGVyIFx1MjE5MiBtYWxmb3JtZWRcbiAgICAgIGlmIChwcmVDb3VudCAhPT0gcG9zdENvdW50KSBjdXJyZW50LmNvdW50Q2hhbmdpbmcgPSB0cnVlO1xuICAgICAgaWYgKHByZUNvdW50ID4gMCkgY3VycmVudC5odW5rcy5wdXNoKHsgc3RhcnQ6IHByZVN0YXJ0LCBlbmQ6IHByZVN0YXJ0ICsgcHJlQ291bnQgLSAxIH0pO1xuICAgIH1cbiAgfVxuICBmaW5pc2goKTtcbiAgcmV0dXJuIHNhd0Jsb2NrID8gcmVzdWx0cyA6IG51bGw7XG59XG4iLCAiLyoqXG4gKiBSZXNwb25zZS1hd2FyZSBkZXJpdmF0aW9uIG9mIHJlYWQtdG91Y2ggc3BhbnMgZnJvbSBCYXNoIGB0b29sX3Jlc3BvbnNlYFxuICogb3V0cHV0LCBmb3IgdGhlIGdyZXAvcmlwZ3JlcCBjb21tYW5kIGZhbWlsaWVzIHRoYXQgcGFyc2UtY29tbWFuZC50c1xuICogZGVsaWJlcmF0ZWx5IGNhbm5vdCBjbGFzc2lmeSBmcm9tIGNvbW1hbmQgdGV4dCBhbG9uZTogdGhlIHdpbmRvdyBpcyBhbmNob3JlZFxuICogdG8gbWF0Y2ggcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50IGFuZCBsaXZlcyBpbiB0aGUgcmVzcG9uc2UsIG5vdFxuICogdGhlIGNvbW1hbmQuIHBhcnNlUmVzcG9uc2UgaXMgdGhlIHNlY29uZCBldmlkZW5jZSBzb3VyY2UgdGhlIENsYXVkZSBhbmRcbiAqIENvZGV4IGFkYXB0ZXJzIG1lcmdlIHdpdGggcGFyc2VDb21tYW5kJ3Mgc3BhbnMuXG4gKlxuICogVGhlIGNvbW1vbi8gbGF5ZXIgY29udmVudGlvbiBpcyBsb2FkLWJlYXJpbmc6IG1vZHVsZXMgaW1wb3J0IG9ubHkgYG5vZGU6YFxuICogYnVpbHRpbnMgYW5kIHNpYmxpbmcgbW9kdWxlcyBcdTIwMTQgemVybyBTREsgaW1wb3J0cy4gRW52ZWxvcGUgbm9ybWFsaXphdGlvblxuICogKGB0b29sX3Jlc3BvbnNlYCBcdTIxOTIgUmVzcG9uc2VQYXJzZUlucHV0KSBoYXBwZW5zIGluIHRoZSBhZGFwdGVycywgd2hpY2ggaGFuZFxuICogdGhlIGFscmVhZHktbm9ybWFsaXplZCBzaGFwZSBkb3duIGhlcmUuXG4gKlxuICogUGhhc2UgM2Egb2YgdGhlIFRERCBib290c3RyYXAgKHBsYW5zL2luaXRpYWwubWQpIGlzIGxpdmU6IGNvbW1hbmQgZ2F0aW5nLFxuICogc2NvcGUgcmVzdHJpY3Rpb24gYWdhaW5zdCB0aGUgY29tbWFuZCdzIGRlY2xhcmVkIHJvb3RzLCBBTlNJIHJlamVjdGlvbiwgdGhlXG4gKiBmaXZlIHNlYXJjaC1sYXlvdXQgZGVjb2RlcnMsIHdob2xlLWZpbGUgZmFsbGJhY2ssIGFuZCBjb2FsZXNjaW5nLiBQaGFzZSAzYlxuICogYWRkZWQgdGhlIHVuaWZpZWQtZGlmZiBkZWNvZGVyIChgZ2l0IGRpZmZgLCBkaWZmLWZvcm0gYGdpdCBzaG93YCwgYGdpdCBsb2dcbiAqIC1wYCkgd2l0aCBiaW5hcnkvY29tYmluZWQvc3VibW9kdWxlIHJlamVjdGlvbiwgYW5kIFBoYXNlIDNjIHRoZVxuICogYGdpdCBibGFtZSAtTCBOLE0gZmlsZWAgY29tbWFuZC10ZXh0IG1hdGNoZXIuIFRoZSBldmFsdWF0aW9uIGZpeGVzIGFkZCB0aGVcbiAqIGRlY2lzaW9ucyB0aGUgcGxhbidzIHJpc2sgc2VjdGlvbiBkZWZlcnJlZCwgYWxsIGRvY3VtZW50ZWQgaGVyZTpcbiAqXG4gKiAtICoqVHJ1bmNhdGlvbiwgdHdvIHJlZ2ltZXMqKiAocGxhbiBzdGVwIDYpOiBgdHJ1bmNhdGVkOiB0cnVlYCAodGhlXG4gKiAgIGFkYXB0ZXIncyBgcmF3T3V0cHV0UGF0aGAgcHJldmlldyBtYXJrZXIpIG1lYW5zIHBhcnNlIG5vdGhpbmcgXHUyMDE0XG4gKiAgIHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlIGZhaWxzIGNsb3NlZC4gYGludGVycnVwdGVkOiB0cnVlYCBpcyB0aGVcbiAqICAgcGxhbidzIGNvbXBsZXRlLXJlY29yZHMgcmVnaW1lOiBmdWxseS10ZXJtaW5hdGVkIHJlY29yZHMgcGFyc2UgYW5kIHRoZVxuICogICBpbmNvbXBsZXRlIHRhaWwgZHJvcHMgdmlhIHRoZSB1bmNvbmRpdGlvbmFsIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSxcbiAqICAgc28gdGhlIGZsYWcgY2hhbmdlcyBub3RoaW5nIHRoZSBkZWZhdWx0IHBhdGggYWxyZWFkeSBkb2VzIFx1MjAxNCBpdCBpc1xuICogICBjb250cmFjdCBkb2N1bWVudGF0aW9uIHRoZSBhZGFwdGVycyBtYXAgYGludGVycnVwdGVkYCBvbnRvIChhIGxhdGVyXG4gKiAgIHBoYXNlIGNoYW5nZXMgdGhlIGFkYXB0ZXJzOyB1bnRpbCB0aGVuIHRoZXkgY29sbGFwc2UgaXQgaW50b1xuICogICBgdHJ1bmNhdGVkYCwgd2hpY2ggZmFpbHMgY2xvc2VkIHNhZmVseSkuIE5laXRoZXIgY29udGVudCBnYXRlIGFwcGxpZXNcbiAqICAgdG8gdGhlIGNvbW1hbmQtdGV4dC1kZXJpdmVkIGBnaXQgYmxhbWUgLUwgTixNYCBtYXRjaGVyLCB3aG9zZSBldmlkZW5jZVxuICogICBpcyB0aGUgY29tbWFuZCwgbm90IHRoZSByZXNwb25zZSBcdTIwMTQgdGhlIGJsYW1lIGJyYW5jaCBydW5zIGFib3ZlIGJvdGhcbiAqICAgdGhlIEFOU0kgcmVqZWN0aW9uIGFuZCB0aGUgdHJ1bmNhdGVkIGdhdGUuXG4gKiAtICoqU3BhbiBjYXAqKjogYE1BWF9SRVNQT05TRV9TUEFOU2AgYm91bmRzIGhvdyBtYW55IGRpc3RpbmN0IHNwYW5zIGFcbiAqICAgcmVzcG9uc2UgbWF5IGVtaXQuIE1lYXN1cmVkIHRocm91Z2ggdGhlIGRlcGxveWVkIGhvb2ssIGVhY2ggc3BhbiBjb3N0c1xuICogICB+NDYgbXMgb2Ygc3VicHJvY2VzcyBleGVjcyBpbiB0aGUgdG91Y2ggY29yZSAocmVzb2x2ZVRvdWNoU2NvcGUgKyBgZ2l0XG4gKiAgIHNwYW4gbGlzdGAgcGVyIHNwYW47IHRoZSBzZXNzaW9uIG1lbW8gbWFrZXMgcmVwZWF0IHJ1bnMgY2hlYXAsIGJ1dCBmaXJzdFxuICogICBydW5zIHBheSB0aGUgZnVsbCBwcmljZSksIGFnYWluc3QgYSAxMCBzIGhvb2tzLmpzb24gdGltZW91dC4gNTAgc3BhbnMgXHUyMjQ4XG4gKiAgIDIuMyBzIHdvcnN0IGNhc2UgXHUyMDE0IHdlbGwgdW5kZXIgdGhlIHRpbWVvdXQgd2l0aCBtYXJnaW4gZXZlbiB3aXRoIHRoZVxuICogICBjb21tYW5kLWRlcml2ZWQgc3BhbnMgb24gdG9wLiBCZXlvbmQgdGhlIGNhcCB0aGUgYm91bmRlZCBzZXQgaXMgZW1pdHRlZFxuICogICAodGhlIGZpcnN0IDUwIGluIGRldGVybWluaXN0aWMgcGF0aCBvcmRlcikgYW5kIHRoZSByZXN0IGZhaWwgY2xvc2VkOlxuICogICBldmVyeSBlbWl0dGVkIHNwYW4gaXMgYSBnZW51aW5lIGZ1bGx5LW9ic2VydmVkIHJlY29yZCwgc28gZW1pdHRpbmcgdGhlXG4gKiAgIGJvdW5kZWQgc2V0IGludmVudHMgbm90aGluZywgYW5kIGRyb3BwaW5nIHRoZSBleGNlc3Mga2VlcHMgaG9vayBsYXRlbmN5XG4gKiAgIGJvdW5kZWQgb24gZXhhY3RseSB0aGUgcGF0aG9sb2dpY2FsIHNlYXJjaGVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIHN0YWxsXG4gKiAgIHRoZSBhZ2VudCBsb29wLiBPbmUgY29hbGVzY2VkIHNwYW4gY292ZXJpbmcgYSBodWdlIHdpbmRvdyBjb3VudHMgb25jZS5cbiAqIC0gKipQaXBlbGluZXMqKjogdGhlIHJlc3BvbnNlIGlzIGF0dHJpYnV0ZWQgdG8gdGhlIEZJUlNUIGdhdGVkIHN0YWdlXG4gKiAgIChsZWZ0LXRvLXJpZ2h0IHdhbGs7IGlmIG5vIHN0YWdlIGdhdGVzLCBub3RoaW5nIHRvIHBhcnNlKS4gSW4gYSBwaXBlbGluZVxuICogICB0aGUgZmluYWwgc3RhZ2UncyBzdGRvdXQgaXMgdGhlIGdhdGVkIHN0YWdlJ3Mgb3V0cHV0IHdoZW4gZXZlcnkgbGF0ZXJcbiAqICAgc3RhZ2UgaXMgUFJPVkFCTFkgVkVSQkFUSU0gXHUyMDE0IHRoZSBhbGxvd2xpc3QgaXMgdGhlIGNsb3NhYmxlIHNldDpcbiAqICAgaGVhZC90YWlsL3djL3NvcnQvdW5pcS9jdXQgKHRydW5jYXRlL3Jlb3JkZXIvZGVkdXBlIFx1MjAxNCBlYWNoIHN1cnZpdmluZ1xuICogICBsaW5lJ3MgY29udGVudCBpcyB2ZXJiYXRpbSksIHBsYWluIGBjYXRgIChubyBgLW5gL2AtLW51bWJlcmApLCB0aGUgZ3JlcFxuICogICBmYW1pbHkgd2l0aG91dCBudW1iZXJlZCBldmlkZW5jZSAoYC1uYC9gLS1saW5lLW51bWJlcmApIGFuZCB3aXRob3V0XG4gKiAgIGZpbGUgb3BlcmFuZHMgYmV5b25kIHRoZSBwYXR0ZXJuIHNsb3QsIGFuZCB0aGUgZXhwcmVzc2lvbi1hbGxvd2xpc3RlZFxuICogICBzZWQvYXdrL3BlcmwvdHIgY2FydmUtb3V0cyAobnVtZXJpYy1hZGRyZXNzIGBwYC9gcWAvYGRgIHNjcmlwdHMsXG4gKiAgIGNvbmRpdGlvbi1vbmx5IE5SLWNvbXBhcmlzb24vcGFyaXR5IGF3ayBwcm9ncmFtcywgc3RyZWFtLXBvc2l0aW9uXG4gKiAgIGBwcmludCBpZi91bmxlc3MgJC4gTiBkYCBwZXJsIHNjcmlwdHMsIGFuZCBkaWdpdC9jb2xvbi9uZXdsaW5lLWZyZWVcbiAqICAgYHRyIC1kYCBkZWxldGlvbnMgXHUyMDE0IGFsbCBwcm92YWJseSBwYXNzIHdob2xlIHJlY29yZHMgdGhyb3VnaFxuICogICBieXRlLXZlcmJhdGltKS4gRXZlcnkgYWxsb3dsaXN0ZWQgc3RhZ2UgbXVzdCBjYXJyeSBOTyBGSUxFIE9QRVJBTkRTOiBhXG4gKiAgIHRva2VuIHRoYXQgaXMgbm90IGEgZmxhZyBuYW1lcyBhIGZpbGUgdGhlIHN0YWdlIHJlYWRzIGluc3RlYWQgb2YgdGhlXG4gKiAgIHBpcGUsIHNvIHRoZSByZXNwb25zZSdzIHJlY29yZHMgY29tZSBmcm9tIHRoYXQgZmlsZSwgbm90IHRoZSBnYXRlZFxuICogICBzdGFnZSwgYW5kIGEgY3JhZnRlZCByZWNvcmQgZGVjb2RlcyBhcyBhIHBoYW50b20gdG91Y2ggXHUyMDE0IHRoYXQgZm9ybVxuICogICBmYWlscyBjbG9zZWQgd2l0aCB0aGUgcmVzdC4gVGhlIHNhbWUgcnVsZSBjb3ZlcnMgYW4gVU5RVU9URUQgYDxgIFx1MjAxNCBhXG4gKiAgIHN0ZGluIHJlZGlyZWN0LCBzdGFuZGFsb25lIG9yIEdMVUVEIGluc2lkZSBhIHRva2VuIChgaGVhZCAtMjxjcmFmdGVkLnR4dGAsXG4gKiAgIGBncmVwIG5lZWRsZTxjcmFmdGVkLnR4dGAsIGEgY29uc3VtZWQgYC1lYC9gLWZgIHZhbHVlKSBcdTIwMTQgYmVjYXVzZSB0aGVcbiAqICAgc3RhZ2UgdGhlbiByZWFkcyBhIGZpbGUgaW5zdGVhZCBvZiB0aGUgcGlwZTsgdGhlIGhhc1VucXVvdGVkUmVkaXJlY3RcbiAqICAgc2NhbiBpcyBxdW90ZS1hd2FyZSwgc28gYSBxdW90ZWQgbGl0ZXJhbCBgPGAgaW4gYSBwYXR0ZXJuXG4gKiAgIChgcmcgLW4gJzxkaXY+J2ApIGlzIG5vdCBhIHJlZGlyZWN0LiBBIGA8PGAvYDw8LWAgSEVSRURPQyBzdGFnZVxuICogICAoYGNhdCA8PCdFT0YnYCkgcmVhZHMgaXRzIHN0ZGluIGZyb20gdGhlIGJvZHkgdGV4dCBcdTIwMTQgYSBjcmFmdGVkIGJvZHkgaXNcbiAqICAgdGhlIHNhbWUgZmFicmljYXRlZC1yZWNvcmQgc291cmNlIGFzIGEgY3JhZnRlZCBmaWxlIFx1MjAxNCBhbmQgdGhlIHNwbGl0dGVyXG4gKiAgIHN0cmlwcyB0aGUgb3BlcmF0b3IgZnJvbSB0aGUgdGV4dCwgc28gdGhlIHBlci1zdGFnZSBgaGVyZWRvY2AgZmxhZ1xuICogICBkcml2ZXMgdGhlIHNhbWUgZmFpbC1jbG9zZWQgcnVsZS4gVGhlIHRlcm1pbmF0aW5nLW5ld2xpbmUgcnVsZSBoYW5kbGVzXG4gKiAgIHRoZSBjdXQuIEV2ZXJ5dGhpbmcgZWxzZSBmYWlscyBDTE9TRUQgXHUyMDE0IHRoZSBkZWZhdWx0IGlzIGludmVydGVkLCBzb1xuICogICBhbnkgc3RhZ2Ugbm90IHByb3ZhYmx5IHZlcmJhdGltIChweXRob24sIHJ1YnksIG1hd2ssIGdhd2ssIHBhc3RlLCBhbmRcbiAqICAgdGhlIHJlc3Qgb2YgYW4gdW5ib3VuZGVkIHJlbnVtYmVyZXIgc2V0KSBtYXkgcmVudW1iZXIgb3IgcmV3cml0ZSB0aGVcbiAqICAgcmVjb3JkcywgdGhlIHJlc3BvbnNlIHRoZW4gY2FycmllcyBzdHJlYW0gcG9zaXRpb25zIGluc3RlYWQgb2YgZmlsZVxuICogICBsaW5lcywgYW5kIHRoZSBwaXBlbGluZSBhdHRyaWJ1dGVzIG5vdGhpbmcuXG4gKiAgIEluIGEgYDtgL2AmJmAvYHx8YC9gJmAvbmV3bGluZSBjaGFpbiB0aGUgc2FtZSBwcm92YWJseS12ZXJiYXRpbSBjaGVja1xuICogICBhcHBsaWVzIHRvIEVWRVJZIHNpYmxpbmcgc3RhZ2UsIGluIGVpdGhlciBkaXJlY3Rpb246IGEgc2libGluZydzIG91dHB1dFxuICogICBtaXhlcyBpbnRvIHRoZSBzYW1lIHJlc3BvbnNlLCBzbyBhIGNyYWZ0ZWQgZmlsZSByZWFkIGJ5IGFueSBvZiB0aGVtXG4gKiAgIGRlY29kZXMgYXMgcGhhbnRvbSB0b3VjaGVzIFx1MjAxNCBhIGNoYWluIGlzIGF0dHJpYnV0YWJsZSBvbmx5IHdoZW4gZXZlcnlcbiAqICAgc2libGluZyBwYXNzZXMgdGhlIGFsbG93bGlzdCAoYGNkYCBzdGFnZXMsIHdob3NlIG91dHB1dCBpcyBlbXB0eSxcbiAqICAgZXhjZXB0ZWQpLiBBIGB8YC1qb2luZWQgZmVlZGVyIGVhcmxpZXIgaW4gdGhlIHBpcGVsaW5lIGlzIGNvbnN1bWVkIGJ5XG4gKiAgIHRoZSBnYXRlZCBzdGFnZSBcdTIwMTQgYSBzZWFyY2ggd2l0aCBleHBsaWNpdCByb290cyBpZ25vcmVzIHN0ZGluIFx1MjAxNCBhbmQgaXRzXG4gKiAgIHJlY29yZHMgbmV2ZXIgcmVhY2ggdGhlIHJlc3BvbnNlOyBpdCBzdGF5cyBvcGVuLlxuICogICBgY2RgIHRyYWNraW5nIGFwcGxpZXMgb25seSB1bnRpbCB0aGUgZmlyc3RcbiAqICAgZ2F0ZWQgc3RhZ2UgaXMgZm91bmQgXHUyMDE0IHRoZSBldmlkZW5jZSB3YXMgcHJvZHVjZWQgaW4gdGhhdCBkaXJlY3RvcnkuXG4gKiAtICoqU3RkaW4tZmVkIHNlYXJjaCBmYWlscyBjbG9zZWQqKjogYSBub24tZ2l0IHNlYXJjaCBiaW4gKGByZ2AvYGdyZXBgL1xuICogICBgZWdyZXBgL2BmZ3JlcGApIHdpdGggbm8gcGF0aCBhcmdzIHdob3NlIGlucHV0IGlzIHBpcGVkIG9yIHJlZGlyZWN0ZWRcbiAqICAgKGBwcmludGYgJ1x1MjAyNicgfCByZyAtbiBuZWVkbGVgLCBgPCBmaWxlYCwgYDw8PGAsIGA8KFx1MjAyNilgLCBhbmQgdGhlIEdMVUVEXG4gKiAgIGZvcm1zIFx1MjAxNCBgcmcgbmVlZGxlPGZpbGVgLCBgaGVhZCAtMjxmaWxlYCwgYSBjb25zdW1lZCBgLWVgL2AtZmAgdmFsdWVcbiAqICAgbGlrZSBgLWUgbmVlZGxlPGZpbGVgIFx1MjAxNCB3aGVyZSB0aGUgcmVkaXJlY3QgaXMgaW52aXNpYmxlIHRvIGFyZ3ZcbiAqICAgc3BsaXR0aW5nIGFuZCBvbmx5IHRoZSBxdW90ZS1hd2FyZSBoYXNVbnF1b3RlZFJlZGlyZWN0IHNjYW4gc2VlcyBpdCwgb3JcbiAqICAgYSBgPDxgL2A8PC1gIEhFUkVET0MgYm9keSBcdTIwMTQgd2hlcmUgdGhlIHNwbGl0dGVyIHN0cmlwcyB0aGUgb3BlcmF0b3IgZnJvbVxuICogICB0aGUgdGV4dCBhbmQgb25seSB0aGUgcGVyLXN0YWdlIGBoZXJlZG9jYCBmbGFnIHNlZXMgaXQpIHJlYWRzIFNURElOLFxuICogICBub3QgZmlsZXMgXHUyMDE0IHRoZSByZXNwb25zZSdzIHJlY29yZHMgYXJlIHN0cmVhbSBwb3NpdGlvbnMsIGFuZCBkZWNvZGluZ1xuICogICB0aGVtIGFzIHBhdGhzIGZhYnJpY2F0ZXMgdG91Y2hlcyAoYSBzdGRpbiBsaW5lIG51bWJlciBsaWtlIFwiOVwiIGJlY29tZXNcbiAqICAgYSBwYXRoLCBhbmQgd2l0aCBhIHJlYWwgZmlsZSBuYW1lZCBgOWAgYXQgdGhlIGN3ZCB0aGUgcGhhbnRvbVxuICogICBzdXJmYWNlcykuXG4gKiAgIFN1Y2ggYW4gaW52b2NhdGlvbiB5aWVsZHMgbm8gcmVzcG9uc2UtZGVyaXZlZCBzcGFucy4gRXhwbGljaXQgcGF0aCBhcmdzXG4gKiAgIG1lYW4gdGhlIGJpbiBzZWFyY2hlcyBmaWxlcyAodGhlIHJlZGlyZWN0L3BpcGUgaXMgdGhlbiBpcnJlbGV2YW50KSwgYW5kXG4gKiAgIGBnaXQgZ3JlcGAgbmV2ZXIgcmVhZHMgc3RkaW4gXHUyMDE0IGJvdGggcHJlc2VydmVkLiBUaGlzIGludmFyaWFudCBiaW5kcyBvbmx5XG4gKiAgIHRoZSBkaXJlY3RseS1nYXRlZCBzdGFnZTogdGhlIGF0dHJpYnV0aW9uIHdhbGsgc3RvcHMgYXQgdGhlIGZpcnN0IGdhdGVkXG4gKiAgIHN0YWdlLCBzbyBhbiB1bi1nYXRlZCBmZWVkZXIgZWFybGllciBpbiB0aGUgcGlwZWxpbmUgKGUuZy5cbiAqICAgYGZpbmQgfCB4YXJncyByZyBcdTIwMjZgKSBuZXZlciByZWFjaGVzIHRoZSBzdGRpbiBydWxlLCBhbmQgaXRzIGZlZWQtc2hhcGVcbiAqICAgaXMgbm8gZXZpZGVuY2UgYWJvdXQgdGhlIHNlYXJjaCdzIHN0ZGluLlxuICogLSAqKkRlY29kZWQgcGF0aHMgbXVzdCBiZSByZWFsIGZpbGVzKio6IGFzIGEgZmFtaWx5LXdpZGUgYmFja3N0b3AsIGFcbiAqICAgcmVjdXJzaXZlLWxheW91dCByZWNvcmQgd2hvc2UgZGVjb2RlZCBwYXRoIGlzIG5vdCBhbiBleGlzdGluZyByZWd1bGFyXG4gKiAgIGZpbGUgKHRoZSBzYW1lIGBpc0ZpbGVgIGNoZWNrIHRoZSBvbmUtZmlsZSBlbGlnaWJpbGl0eSB1c2VzLCByZXNvbHZpbmdcbiAqICAgYWdhaW5zdCB0aGUgcmVjb3JkIGJhc2UpIGRyb3BzIGluc3RlYWQgb2YgZmFicmljYXRpbmcgYSB0b3VjaC5cbiAqIC0gKipgZ2l0IHNob3cgPHJldj46PHBhdGg+YCoqIChyYXcgYmxvYiBjb250ZW50KSBpcyBleGNsdWRlZCBmcm9tIHRoZSBkaWZmXG4gKiAgIGdhdGU7IGEgZGlmZi1zaGFwZWQgYmxvYiBtdXN0IG5ldmVyIGRlY29kZSBpbnRvIGZhYnJpY2F0ZWQgdG91Y2hlcy4gVGhlXG4gKiAgIGNvbnRlbnQgaWRpb20gaXMgZGV0ZWN0YWJsZSBmcm9tIHRoZSBjb21tYW5kOiBhIGBzaG93YCBwb3NpdGlvbmFsXG4gKiAgIGNvbnRhaW5pbmcgYDpgIGlzIGEgcmV2OnBhdGgsIG5vdCBhIHJldmlzaW9uLlxuICogLSAqKkRpZmYgcGF0aHMgYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSoqOiBnaXQgZW1pdHMgYGEvc3JjL3gudHNgIGluIGRpZmZcbiAqICAgb3V0cHV0IHJlZ2FyZGxlc3Mgb2YgY3dkLCBzbyBkaWZmIGRlY29kZSBhbmNob3JzIHRvIHRoZSB3b3JrdHJlZSByb290XG4gKiAgIChmb3VuZCBieSB3YWxraW5nIHVwIGZyb20gdGhlIGVmZmVjdGl2ZSBkaXIgZm9yIGEgYC5naXRgIGVudHJ5IFx1MjAxNCBub1xuICogICBzdWJwcm9jZXNzLCB0aGUgY29tbW9uIGxheWVyIGltcG9ydHMgb25seSBub2RlOiBidWlsdGlucykuIFR3b1xuICogICBleGNlcHRpb25zIHJlLWFuY2hvciB0aGUgb3V0cHV0OiBgLS1yZWxhdGl2ZWAgKGJhcmUpIGVtaXRzIHBhdGhzXG4gKiAgIHJlbGF0aXZlIHRvIHRoZSBjd2QgYW5kIGV4Y2x1ZGVzIGNoYW5nZXMgb3V0c2lkZSBpdCwgYW5kXG4gKiAgIGAtLXJlbGF0aXZlPTxwYXRoPmAgZW1pdHMgcGF0aHMgcmVsYXRpdmUgdG8gYDxwYXRoPmAgcmVzb2x2ZWQgYWdhaW5zdFxuICogICB0aGUgd29ya3RyZWUgcm9vdCAodmVyaWZpZWQgYWdhaW5zdCBnaXQgMi40Ny4zKSBcdTIwMTQgYm90aCBkZWNvZGUgYWdhaW5zdFxuICogICB0aGF0IGJhc2UgaW5zdGVhZC4gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPiA8cmV2Pjo8cGF0aD5gICh0d28tYXJnXG4gKiAgIGJsb2ItYmxvYikgZW1pdHMgYSBub3JtYWwgdW5pZmllZCBkaWZmIG5hbWluZyB0aGUgYmxvYiBwYXRocyB3aGlsZSBnaXRcbiAqICAgcmVhZHMgb25seSBoaXN0b3JpY2FsIGJsb2JzLCBuZXZlciB0aGUgd29ya2luZy10cmVlIGZpbGVzIFx1MjAxNCBhIGRpZmZcbiAqICAgd2hvc2UgcG9zaXRpb25hbHMgY2FycnkgYHJldjpwYXRoYCBzcGVjcyAoYW55IGA6YC1jb250YWluaW5nIHBvc2l0aW9uYWxcbiAqICAgdGhhdCBpcyBub3QgYW4gZXhpc3RpbmcgZmlsZSkgZGVjb2RlcyBub3RoaW5nLlxuICogLSAqKlVubnVtYmVyZWQgb3V0cHV0IG5ldmVyIHBhcnNlcyBhcyBudW1iZXJlZCoqOiB0aGUgb25lLWZpbGUgbGF5b3V0XG4gKiAgIHJlcXVpcmVzIGNvbW1hbmQtc2lkZSBudW1iZXJlZCBldmlkZW5jZSAoYC1uYC9gLS1saW5lLW51bWJlcmApLCBleGFjdGx5XG4gKiAgIG9uZSBleHBsaWNpdCBmaWxlIGFyZ3VtZW50IHRoYXQgaXMgYSByZWFsIGZpbGUsIG5vIGAtSGBcbiAqICAgKC0td2l0aC1maWxlbmFtZSwgd2hpY2ggZm9yY2VzIHBhdGggcHJlZml4ZXMpLCBhbmQgY3Jvc3MtcmVjb3JkXG4gKiAgIGNvbnNpc3RlbmN5IChldmVyeSByZWNvcmQgcGFyc2VzIGFzIGBsaW5lOnRleHRgKS4gVGhlIGhlYWRpbmcgbGF5b3V0XG4gKiAgIHJlcXVpcmVzIHRoZSBudW1iZXJlZCBldmlkZW5jZSB0b28uIEEgZGlnaXRzLWxlYWRpbmcgcmVjb3JkIHRoYXQgZmFpbHNcbiAqICAgdGhlc2UgY2hlY2tzIGZhbGxzIHRocm91Z2ggdG8gdGhlIHJlY3Vyc2l2ZSBsYXlvdXQgXHUyMDE0IGEgcHVyZS1kaWdpdHNcbiAqICAgZmlsZW5hbWUgKFwiOVwiLCBcIjEyM1wiKSBlbWl0dGVkIGZpcnN0IG11c3Qgbm90IGNvbGxhcHNlIGEgd2hvbGUgc2VhcmNoIHRvXG4gKiAgIHRoZSBvbmUtZmlsZSBsYXlvdXQsIGFuZCBjb250ZW50IHRoYXQgbWVyZWx5IGxvb2tzIG51bWJlcmVkIG11c3Qgbm90XG4gKiAgIGludmVudCBwb3NpdGlvbnMuIEdpdCBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIGlzIG5vdFxuICogICBhIGZpbGVzeXN0ZW0gcGF0aCBhbmQgbmV2ZXIgYmVjb21lcyBhIHBlcm1pdHRlZCByb290LiBgZ2l0IGdyZXAgPHJldj5gXG4gKiAgIGZ1c2VzIHRoZSByZXYgaW50byByZWNvcmQgcGF0aHMgKGBIRUFEOmEudHM6MzpcdTIwMjZgKTsgdGhvc2UgcmVjb3JkcyBkcm9wIGFzXG4gKiAgIHBhdGgtYW1iaWd1b3VzIFx1MjAxNCBmYWlsLWNsb3NlZCBhbmQgZGVmZW5zaWJsZSwgc2luY2UgdGhlIHJldiBpcyBrbm93biBidXRcbiAqICAgc3RyaXBwaW5nIGl0IHdvdWxkIGd1ZXNzIGF0IGEgcGF0aCB0aGUgcmVzcG9uc2UgZG9lcyBub3QgY2FycnkuXG4gKiAtICoqV2hvbGUtdHJlZSBgZ2l0IGdyZXBgIGZyb20gYSBzdWJkaXIgYW5jaG9ycyB0byB0aGUgd29ya3RyZWUgcm9vdCoqOlxuICogICBwYXRoc3BlYyBtYWdpYyAoYDovYCwgYDohYCwgYDpeYCwgYDooLi4uKWApIHNlYXJjaGVzIHRoZSB3aG9sZSB0cmVlIGFuZFxuICogICBlbWl0cyBjd2QtcmVsYXRpdmUgcmVjb3JkcyB3aXRoIGAuLi9gIHByZWZpeGVzOyBgLS1mdWxsLW5hbWVgICh0aGUgcmVhbFxuICogICBnaXQgb3B0aW9uIFx1MjAxNCBgLS1mdWxsLXRyZWVgIGRvZXMgbm90IGV4aXN0IG9uIGdpdCAyLjQ3LjMgYW5kIGVycm9ycyB3aXRoXG4gKiAgIGEgdXNhZ2UgcmVzcG9uc2UgdGhhdCBwYXJzZXMgdG8gbm90aGluZykgcmUtYW5jaG9ycyByZWNvcmRzIHRvXG4gKiAgIHJlcG8tcm9vdC1yZWxhdGl2ZSBwYXRocy4gQm90aCBhbmNob3IgdGhlIHBlcm1pdHRlZCByb290IFx1MjAxNCBhbmQsIGZvclxuICogICBgLS1mdWxsLW5hbWVgLCB0aGUgcmVzb2x1dGlvbiBiYXNlIFx1MjAxNCB0byB0aGUgd29ya3RyZWUgcm9vdCwgc28gZXZlcnlcbiAqICAgaW4tcmVwbyByZWNvcmQgcGFzc2VzIGNvbnRhaW5tZW50LiBQbGFpbiBzdWJkaXIgYGdpdCBncmVwYCAobm9cbiAqICAgcGF0aHNwZWMpIGlzIHNjb3BlZCB0byB0aGUgc3ViZGlyIGJ5IGdpdCBpdHNlbGYgYW5kIGtlZXBzIHRoZVxuICogICBlZmZlY3RpdmUtZGlyIHJvb3QuXG4gKiAtICoqQ29udGV4dCByZWNvcmRzIHdpdGggZGFzaGVzIGluIHRoZSBwYXRoKiogZGVjb2RlIGJ5IGFuY2hvcmluZyB0byB0aGVcbiAqICAgZXhhY3QgcGF0aHMgdGhlIHJlc3BvbnNlJ3MgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzIGVzdGFibGlzaCxcbiAqICAgd2l0aCB0aGUgZGFzaCBzcGxpdCBhcyB0aGUgZGFzaC1mcmVlIGZhbGxiYWNrIFx1MjAxNCBhIGAtQ2Agd2luZG93IG9uXG4gKiAgIGBzcmMvbXktZmlsZS50c2AgbXVzdCBub3QgY29sbGFwc2UgdG8gdGhlIGJhcmUgbWF0Y2ggbGluZS5cbiAqXG4gKiBUaGUgYWNjZXB0YW5jZSBjaGVja3MgaW4gdGVzdC9jb21tb24vcGFyc2UtcmVzcG9uc2UudGVzdC50cyB3ZXJlIHdyaXR0ZW5cbiAqIGluIFBoYXNlIDIuXG4gKi9cbmltcG9ydCB7IGV4aXN0c1N5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBkaXJuYW1lLCBqb2luLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQgeyBhcmd2T2YsIGhhc1VucXVvdGVkUmVkaXJlY3QsIHR5cGUgT3BlcmF0b3IsIHNwbGl0VG9wTGV2ZWwgfSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcblxuLyoqXG4gKiBBIHJlc3BvbnNlLWRlcml2ZWQgcmVhZCBzcGFuOiBhbHdheXMgYW4gZXhhY3QgbGluZSByYW5nZSBpbiBvbmUgZmlsZS5cbiAqIERpc3RpbmN0IGZyb20gdGhlIGNvbW1hbmQgcGFyc2VyJ3Mge0BsaW5rIFJlc29sdmVkU3Bhbn0gXHUyMDE0IHJlc3BvbnNlIHNwYW5zXG4gKiBjYXJyeSBubyBgb3BlcmF0aW9uYC9gc2ltcGxlQ29tbWFuZEluZGV4YCAodGhleSBhcmUgbm90IHRpZWQgdG8gYSBzaW1wbGVcbiAqIGNvbW1hbmQ7IHRoZSBhZGFwdGVycyBydW4gZWFjaCBhcyBhIGJhcmUgcmVhZCB0b3VjaCksIGFuZCB0aGVpciByYW5nZSBpc1xuICogYWx3YXlzIHByZXNlbnQsIGJlY2F1c2UgZXZlcnkgcmVzcG9uc2UgZGVjb2RlIGxvY2F0ZXMgaXRzIHJlYWQgd2luZG93IGluXG4gKiB0aGUgb3V0cHV0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlc3BvbnNlU3BhbiB7XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICBsaW5lU3RhcnQ6IG51bWJlcjtcbiAgbGluZUVuZDogbnVtYmVyO1xufVxuXG4vKipcbiAqIFRoZSBub3JtYWxpemVkIHRvb2wtcmVzcG9uc2UgaW5wdXQgdGhlIGFkYXB0ZXJzIGhhbmQgdGhlIHNoYXJlZCBwYXJzZXIuXG4gKiBgc3Rkb3V0YCBpcyB0aGUgKHBvc3NpYmx5IHByZXZpZXcpIG91dHB1dCB0ZXh0OyBgc3RkZXJyYCBhbmQgYGV4aXRTdGF0dXNgXG4gKiBhcmUgY2FycmllZCBmb3IgZGlhZ25vc3RpY3MgYW5kIGFyZSBuZXZlciBwYXJzZSBnYXRlcyBcdTIwMTQgYGdpdCBkaWZmXG4gKiAtLWV4aXQtY29kZWAgZXhpdHMgMSBvbiBkaWZmZXJlbmNlcywgc28gZXhpdCBzdGF0dXMgbXVzdCBub3QgYmUgdHJlYXRlZCBhc1xuICogZmFpbHVyZS4gUGxhbiBzdGVwIDYncyB0d28gdHJ1bmNhdGlvbiByZWdpbWVzIGFyZSBkaXN0aW5jdCBmaWVsZHM6XG4gKlxuICogLSBgdHJ1bmNhdGVkYCAoQ2xhdWRlIGByYXdPdXRwdXRQYXRoYCBzZXQgXHUyMUQyIGlubGluZSBzdGRvdXQgaXMgb25seSBhXG4gKiAgIHByZXZpZXcpIGlzIHN0cmljdCBtb2RlOiByZXNwb25zZS1kZXJpdmVkIGRlY29kZSBwYXJzZXMgbm90aGluZyBhbmRcbiAqICAgaW52ZW50cyBubyB0b3VjaGVzLiBUaGUgY29tbWFuZC10ZXh0LWRlcml2ZWQgYGdpdCBibGFtZSAtTGAgbWF0Y2hlciBpc1xuICogICBleGVtcHQgXHUyMDE0IGl0cyBldmlkZW5jZSBpcyB0aGUgY29tbWFuZCwgbm90IHRoZSByZXNwb25zZS5cbiAqIC0gYGludGVycnVwdGVkYCBpcyB0aGUgY29tcGxldGUtcmVjb3JkcyByZWdpbWU6IGZ1bGx5LXRlcm1pbmF0ZWQgcmVjb3Jkc1xuICogICBwYXJzZSBhbmQgdGhlIGluY29tcGxldGUgdGFpbCBkcm9wcy4gVGhlIHVuY29uZGl0aW9uYWwgdGVybWluYXRpbmctXG4gKiAgIG5ld2xpbmUgcnVsZSBhbHJlYWR5IGRvZXMgZXhhY3RseSB0aGF0LCBzbyB0aGUgZmxhZyBpcyBjb250cmFjdFxuICogICBkb2N1bWVudGF0aW9uIHRoZSBhZGFwdGVycyBtYXAgYGludGVycnVwdGVkOiB0cnVlYCBvbnRvOyBpdCBuZXZlclxuICogICBzdXBwcmVzc2VzIGEgcmVzcG9uc2UgdGhlIGRlZmF1bHQgcGF0aCB3b3VsZCBwYXJzZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZXNwb25zZVBhcnNlSW5wdXQge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIGN3ZDogc3RyaW5nO1xuICBzdGRvdXQ6IHN0cmluZztcbiAgc3RkZXJyPzogc3RyaW5nO1xuICBleGl0U3RhdHVzPzogbnVtYmVyOyAvLyBtZXRhZGF0YSBvbmx5IFx1MjAxNCBuZXZlciBnYXRlcyAoZ2l0IGRpZmYgZXhpdHMgMSBvbiBkaWZmZXJlbmNlcylcbiAgdHJ1bmNhdGVkPzogYm9vbGVhbjtcbiAgaW50ZXJydXB0ZWQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFRoZSBtYXhpbXVtIG51bWJlciBvZiBkaXN0aW5jdCBzcGFucyBgcGFyc2VSZXNwb25zZWAgbWF5IGVtaXQuIE1lYXN1cmVkXG4gKiB0aHJvdWdoIHRoZSBkZXBsb3llZCBob29rLCBlYWNoIHNwYW4gY29zdHMgfjQ2IG1zIG9mIHN1YnByb2Nlc3MgZXhlY3MgaW5cbiAqIHRoZSB0b3VjaCBjb3JlIChyZXNvbHZlVG91Y2hTY29wZSArIGBnaXQgc3BhbiBsaXN0YCBwZXIgc3BhbjsgdGhlIHNlc3Npb25cbiAqIG1lbW8gbWFrZXMgcmVwZWF0IHJ1bnMgY2hlYXAsIGJ1dCBmaXJzdCBydW5zIHBheSB0aGUgZnVsbCBwcmljZSkgYWdhaW5zdCBhXG4gKiAxMCBzIGhvb2tzLmpzb24gdGltZW91dCBcdTIwMTQgNTAgc3BhbnMgXHUyMjQ4IDIuMyBzIHdvcnN0IGNhc2UsIHdlbGwgdW5kZXIgdGhlXG4gKiB0aW1lb3V0IHdpdGggbWFyZ2luIGV2ZW4gd2l0aCB0aGUgY29tbWFuZC1kZXJpdmVkIHNwYW5zIG9uIHRvcC4gVGhlIHBsYW4nc1xuICogcmlzayBzZWN0aW9uIGRlZmVycmVkIHRoaXMgY2FwIChcImZhaWwgY2xvc2VkIGJleW9uZCBpdFwiKSB0byBhIFBoYXNlIDNhXG4gKiBtZWFzdXJlbWVudDsgdGhlIGdvbGRlbiBtYXRyaXgncyBsYXJnZXN0IHJlYWxpc3RpYyBvdXRwdXRzIHN0YXkgZmFyIGJlbG93XG4gKiBpdCwgc28gaXQgYmluZHMgb25seSBwYXRob2xvZ2ljYWwgc2VhcmNoZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBNQVhfUkVTUE9OU0VfU1BBTlMgPSA1MDtcblxuLyoqXG4gKiBBIHNpbmdsZSBkZWNvZGVkIHNlYXJjaC1vdXRwdXQgcmVjb3JkLiBUaGUgcGF0aC9saW5lIHNwbGl0IGlzIGxheW91dC1cbiAqIGRlcGVuZGVudDogYHBhdGg6bGluZTp0ZXh0YCAocmVjdXJzaXZlKSwgYHBhdGgtbGluZTp0ZXh0YCAoY29udGV4dCBsaW5lcyBpblxuICogLUEvLUIvLUMgZ3JvdXBzIGNhcnJ5IG5vIG51bWJlciBcdTIwMTQgYGxpbmVgIGlzIG51bGwgYW5kIHRoZSByZWNvcmQgYWR2YW5jZXNcbiAqIHRoZSBwZXItZmlsZSBjb3VudGVyIGluc3RlYWQpLCBgbGluZTp0ZXh0YCAob25lLWZpbGUgbGF5b3V0KSwgb3IgYVxuICogTlVMLXRlcm1pbmF0ZWQgYHBhdGg6MTpcdTIwMjZgIHJlY29yZCAoYC16YCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2VhcmNoUmVjb3JkIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVGhlIHJlY29yZCdzIGxpbmUgbnVtYmVyLCBvciBudWxsIGZvciBjb250ZXh0IGxpbmVzIHdpdGhvdXQgb25lLiAqL1xuICBsaW5lOiBudW1iZXIgfCBudWxsO1xuICB0ZXh0OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgcmVjb2duaXplZCBzZWFyY2ggb3V0cHV0IGxheW91dHMgdGhlIGRlY29kZXJzIGRpc3Rpbmd1aXNoLiAqL1xuZXhwb3J0IHR5cGUgU2VhcmNoTGF5b3V0ID0gJ3JlY3Vyc2l2ZScgfCAnY29udGV4dCcgfCAnaGVhZGluZycgfCAnbnVsbC1zZXBhcmF0ZWQnIHwgJ29uZS1maWxlJztcblxuLyoqXG4gKiBPbmUgZmlsZSdzIHNlY3Rpb24gb2YgYSB1bmlmaWVkLWRpZmYgcmVzcG9uc2UuIGBvbGRQYXRoYC9gbmV3UGF0aGAgYXJlIHRoZVxuICogYGEvYC1gYi9gLXByZWZpeGVkIHNpZGVzIHdpdGggdGhlIHByZWZpeCBzdHJpcHBlZDsgbnVsbCBmb3IgYC9kZXYvbnVsbGBcbiAqIChuZXctZmlsZSAvIGRlbGV0ZWQtZmlsZSBzaWRlcykuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlmZkZpbGVSZWNvcmQge1xuICBvbGRQYXRoOiBzdHJpbmcgfCBudWxsO1xuICBuZXdQYXRoOiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogUmVuYW1lL2NvcHkgbWV0YWRhdGEgKGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AsIGBjb3B5IGZyb21gL2Bjb3B5IHRvYCk6XG4gICAqIHRoZSBuZXcgcGF0aCBpcyB0aGUgdG91Y2ggdGFyZ2V0LlxuICAgKi9cbiAgcmVuYW1lOiB7IGZyb206IHN0cmluZzsgdG86IHN0cmluZyB9IHwgbnVsbDtcbiAgYmluYXJ5OiBib29sZWFuO1xuICBjb21iaW5lZDogYm9vbGVhbjtcbiAgc3VibW9kdWxlOiBib29sZWFuO1xuICBodW5rczogRGlmZkh1bmtbXTtcbn1cblxuLyoqXG4gKiBBIHVuaWZpZWQtZGlmZiBodW5rIGhlYWRlciAoYEBAIC1hLGIgK2MsZCBAQGApOyBhbiBvbWl0dGVkIGNvdW50IG1lYW5zIDEuXG4gKiBQZXItc2lkZSByYW5nZXMgYXJlIGBvbGRTdGFydC4ub2xkU3RhcnQrb2xkQ291bnQtMWAgb24gdGhlIG9sZCBwYXRoIGFuZFxuICogYG5ld1N0YXJ0Li5uZXdTdGFydCtuZXdDb3VudC0xYCBvbiB0aGUgbmV3IHBhdGguXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGlmZkh1bmsge1xuICBvbGRTdGFydDogbnVtYmVyO1xuICBvbGRDb3VudDogbnVtYmVyO1xuICBuZXdTdGFydDogbnVtYmVyO1xuICBuZXdDb3VudDogbnVtYmVyO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgYW5hbHlzaXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBTRUFSQ0hfQklOUyA9IG5ldyBTZXQoWydyZycsICdncmVwJywgJ2VncmVwJywgJ2ZncmVwJ10pO1xuXG4vKipcbiAqIFNob3J0IG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgdmFsdWUgKHJnL2dyZXApOiAtQS8tQi8tQyAoY29udGV4dCksIC1lLy1mXG4gKiAocGF0dGVybi9maWxlKSwgLW0gKG1heCBjb3VudCksIC1nLy10Ly1UIChyZyB0eXBlL2dsb2IpLiBBbnl0aGluZyBlbHNlIGluIGFcbiAqIHNob3J0IGNsdXN0ZXIgaXMgYSBwbGFpbiBmbGFnLlxuICovXG5jb25zdCBWQUxVRV9TSE9SVF9GTEFHUyA9IG5ldyBTZXQoWydBJywgJ0InLCAnQycsICdlJywgJ2YnLCAnbScsICdnJywgJ3QnLCAnVCddKTtcblxuLyoqIExvbmcgb3B0aW9ucyB0aGF0IGNvbnN1bWUgYSBzZXBhcmF0ZSB2YWx1ZSBhcmd1bWVudC4gKi9cbmNvbnN0IFZBTFVFX0xPTkdfRkxBR1MgPSBuZXcgU2V0KFtcbiAgJ2FmdGVyLWNvbnRleHQnLFxuICAnYmVmb3JlLWNvbnRleHQnLFxuICAnY29udGV4dCcsXG4gICdtYXgtY291bnQnLFxuICAncmVnZXhwJyxcbiAgJ2ZpbGUnLFxuICAnZ2xvYicsXG4gICdpZ2xvYicsXG4gICd0eXBlJyxcbiAgJ3R5cGUtbm90JyxcbiAgJ2luY2x1ZGUnLFxuICAnZXhjbHVkZScsXG4gICdleGNsdWRlLWRpcicsXG4gICdleGNsdWRlLWZyb20nXG5dKTtcblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuaW50ZXJmYWNlIFNlYXJjaEFyZ3ZJbmZvIHtcbiAgLyoqXG4gICAqIFBvc2l0aW9uYWwgcGF0aCBhcmdzOyBlbXB0eSB3aGVuIHRoZSBjb21tYW5kIG5hbWVkIG5vbmUuIFRoZSBmaXJzdFxuICAgKiBwb3NpdGlvbmFsIGlzIHRoZSBwYXR0ZXJuIHVubGVzcyB0aGUgcGF0dGVybiBjYW1lIGZyb20gYSBmbGFnIHZhbHVlXG4gICAqIChgLWVgL2AtZmAvYC0tcmVnZXhwYC9gLS1maWxlYCksIGluIHdoaWNoIGNhc2UgZXZlcnkgcG9zaXRpb25hbCBpcyBhXG4gICAqIHBhdGguXG4gICAqL1xuICBwYXRoQXJnczogc3RyaW5nW107XG4gIC8qKiBXaGV0aGVyIC1BLy1CLy1DIChhbnkgY29udGV4dCB3aW5kb3cpIHdhcyByZXF1ZXN0ZWQuICovXG4gIGNvbnRleHRGbGFnczogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGNvbW1hbmQgcmVxdWVzdGVkIGxpbmUgbnVtYmVycyAoYC1uYC9gLS1saW5lLW51bWJlcmApLiByZyBhbmRcbiAgICogZ3JlcCBib3RoIGRlZmF1bHQgdG8gTk8gbGluZSBudW1iZXJzIHdoZW4gcGlwZWQsIHNvIHRoaXMgaXMgdGhlXG4gICAqIGNvbW1hbmQtc2lkZSBldmlkZW5jZSB0aGF0IGBsaW5lOnRleHRgLW9ubHkgb3V0cHV0IGlzIG51bWJlcmVkIG91dHB1dCBcdTIwMTRcbiAgICogdGhlIG9uZS1maWxlIGFuZCBoZWFkaW5nIGxheW91dHMgcmVmdXNlIHRvIGFwcGx5IHdpdGhvdXQgaXQuIEEgbnVtYmVyZWRcbiAgICogY29tbWFuZCB3aG9zZSByZWNvcmRzIGFsbCBmYWlsIHRvIGRlY29kZSBtdXN0IG5vdCBmYWxsIGJhY2sgdG8gYVxuICAgKiB3aG9sZS1maWxlIHNwYW4gXHUyMDE0IHRoZSByZWNvcmRzIG1heSBoYXZlIGJlZW4gcmVudW1iZXJlZCBvciBkZXN0cm95ZWQgYnkgYVxuICAgKiBsYXRlciBwaXBlbGluZSBzdGFnZS5cbiAgICovXG4gIG51bWJlcmVkOiBib29sZWFuO1xuICAvKiogV2hldGhlciBgLUhgL2AtLXdpdGgtZmlsZW5hbWVgIHdhcyByZXF1ZXN0ZWQgXHUyMDE0IHJlY29yZHMgY2FycnkgcGF0aCBwcmVmaXhlcyBldmVuIGZvciBhIHNpbmdsZSBmaWxlLiAqL1xuICB3aXRoRmlsZW5hbWU6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIGFueSBwb3NpdGlvbmFsIHdhcyBnaXQgcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsXG4gICAqIGA6KC4uLilgKSBcdTIwMTQgYSB3aG9sZS10cmVlIG9yIGV4Y2x1c2lvbiBzcGVjLCBuZXZlciBhIGZpbGVzeXN0ZW0gcm9vdC5cbiAgICogV2hlbiBwcmVzZW50LCBnaXQgZ3JlcCBzZWFyY2hlcyBiZXlvbmQgdGhlIGN3ZCwgc28gdGhlIHBlcm1pdHRlZCByb290XG4gICAqIGFuY2hvcnMgdG8gdGhlIHdvcmt0cmVlIHJvb3QgaW5zdGVhZCBvZiB0aGUgZWZmZWN0aXZlIGRpci5cbiAgICovXG4gIHBhdGhzcGVjTWFnaWM6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgc3RkaW4gcmVkaXJlY3QgKGA8YCwgYDw8PGAsIGA8KFx1MjAyNmApIGFwcGVhcnM6IHRoZSBiaW4gcmVhZHNcbiAgICogU1RESU4sIGFuZCB0aGUgdG9rZW5zIGFmdGVyIHRoZSByZWRpcmVjdCBhcmUgaXRzIHRhcmdldHMsIG5ldmVyIHNlYXJjaFxuICAgKiByb290cyBcdTIwMTQgdGhlIHBvc2l0aW9uYWwgc2NhbiBzdG9wcyB0aGVyZS5cbiAgICovXG4gIHN0ZGluUmVkaXJlY3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogV2hldGhlciBgcGAgaXMgYSBnaXQgcGF0aHNwZWMgbWFnaWMgcHJlZml4IChgOi9gLCBgOiFgLCBgOl5gLCBgOiguLi4pYCkgXHUyMDE0XG4gKiBhIG5vbi1maWxlc3lzdGVtIHBhdGggZm9ybSB0aGF0IG11c3QgbmV2ZXIgYmVjb21lIGEgcGVybWl0dGVkIHJvb3QuIEFcbiAqIGxpdGVyYWwgYGN3ZC86L2Agcm9vdCB3b3VsZCByZWplY3QgZXZlcnkgZGVjb2RlZCByZWNvcmQ7IHRyZWF0aW5nIHBhdGhzcGVjXG4gKiBtYWdpYyBsaWtlIG5vIHBhdGggYXJncyBsZXRzIHJvb3RzIGZhbGwgYmFjayB0byB0aGUgZWZmZWN0aXZlIGN3ZC5cbiAqL1xuZnVuY3Rpb24gaXNQYXRoc3BlY01hZ2ljKHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL146Wy8hXi4oXS8udGVzdChwKTtcbn1cblxuLyoqXG4gKiBTY2FuIGEgc2VhcmNoIGNvbW1hbmQncyBhcmd2IChzdGFydGluZyBhZnRlciB0aGUgYmluYXJ5LCBvciBhZnRlciB0aGVcbiAqIGBncmVwYCBzdWJjb21tYW5kIGZvciBnaXQgZ3JlcCkgZm9yIHRoZSBwb3NpdGlvbmFsIGFyZ3MgYW5kIGNvbnRleHQgZmxhZ3MsXG4gKiBjb25zdW1pbmcgb3B0aW9uIHZhbHVlcyBzbyB0aGV5IGFyZSBuZXZlciBtaXN0YWtlbiBmb3IgcG9zaXRpb25hbHMuXG4gKi9cbmZ1bmN0aW9uIGFuYWx5emVTZWFyY2hBcmd2KGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogU2VhcmNoQXJndkluZm8ge1xuICBjb25zdCBwb3NpdGlvbmFsczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGNvbnRleHRGbGFncyA9IGZhbHNlO1xuICBsZXQgbnVtYmVyZWQgPSBmYWxzZTtcbiAgbGV0IHdpdGhGaWxlbmFtZSA9IGZhbHNlO1xuICBsZXQgcGF0dGVybkZyb21GbGFnID0gZmFsc2U7XG4gIGxldCBzdGRpblJlZGlyZWN0ID0gZmFsc2U7XG4gIGxldCBpID0gc3RhcnQ7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgcG9zaXRpb25hbHMucHVzaCguLi5hcmd2LnNsaWNlKGkgKyAxKSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnPCcpKSB7XG4gICAgICAvLyBBIHN0ZGluIHJlZGlyZWN0IChgPGAsIGA8PDxgLCBgPChcdTIwMjZgKTogdGhlIGJpbiByZWFkcyBzdGRpbiwgYW5kIHRoZVxuICAgICAgLy8gZm9sbG93aW5nIHRva2VucyBhcmUgcmVkaXJlY3QgdGFyZ2V0cywgbm90IHNlYXJjaCByb290cy5cbiAgICAgIHN0ZGluUmVkaXJlY3QgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tJykpIHtcbiAgICAgIGNvbnN0IGVxID0gYS5pbmRleE9mKCc9Jyk7XG4gICAgICBjb25zdCBuYW1lID0gZXEgPT09IC0xID8gYS5zbGljZSgyKSA6IGEuc2xpY2UoMiwgZXEpO1xuICAgICAgaWYgKG5hbWUgPT09ICdhZnRlci1jb250ZXh0JyB8fCBuYW1lID09PSAnYmVmb3JlLWNvbnRleHQnIHx8IG5hbWUgPT09ICdjb250ZXh0JykgY29udGV4dEZsYWdzID0gdHJ1ZTtcbiAgICAgIGlmIChuYW1lID09PSAnbGluZS1udW1iZXInKSBudW1iZXJlZCA9IHRydWU7XG4gICAgICBpZiAobmFtZSA9PT0gJ3dpdGgtZmlsZW5hbWUnKSB3aXRoRmlsZW5hbWUgPSB0cnVlO1xuICAgICAgaWYgKG5hbWUgPT09ICdyZWdleHAnIHx8IG5hbWUgPT09ICdmaWxlJykgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgIGlmIChlcSA9PT0gLTEgJiYgVkFMVUVfTE9OR19GTEFHUy5oYXMobmFtZSkpIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nICYmIGEubGVuZ3RoID4gMSkge1xuICAgICAgbGV0IGNvbnN1bWVzTmV4dCA9IGZhbHNlO1xuICAgICAgZm9yIChsZXQgaiA9IDE7IGogPCBhLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGNvbnN0IGMgPSBhW2pdO1xuICAgICAgICBpZiAoYyA9PT0gJ0EnIHx8IGMgPT09ICdCJyB8fCBjID09PSAnQycpIGNvbnRleHRGbGFncyA9IHRydWU7XG4gICAgICAgIGlmIChjID09PSAnbicpIG51bWJlcmVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKGMgPT09ICdIJykgd2l0aEZpbGVuYW1lID0gdHJ1ZTtcbiAgICAgICAgaWYgKGMgPT09ICdlJyB8fCBjID09PSAnZicpIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7XG4gICAgICAgIGlmIChWQUxVRV9TSE9SVF9GTEFHUy5oYXMoYykpIHtcbiAgICAgICAgICAvLyBBIHZhbHVlLXRha2luZyBmbGFnIGNvbnN1bWVzIHRoZSByZXN0IG9mIHRoZSBjbHVzdGVyIGFzIGl0cyB2YWx1ZVxuICAgICAgICAgIC8vICgtQzEpIG9yLCB3aGVuIGxhc3QsIHRoZSBuZXh0IGFyZ3VtZW50ICgtQyAxKS5cbiAgICAgICAgICBjb25zdW1lc05leHQgPSBqID09PSBhLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGkgKz0gY29uc3VtZXNOZXh0ID8gMiA6IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cbiAgLy8gVGhlIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHBhdHRlcm4gXHUyMDE0IHVubGVzcyB0aGUgcGF0dGVybiBjYW1lIGZyb20gYVxuICAvLyBmbGFnIHZhbHVlIChgLWVgL2AtZmAvYC0tcmVnZXhwYC9gLS1maWxlYCwgc2VwYXJhdGUgb3IgZ2x1ZWQpLCBpbiB3aGljaFxuICAvLyBjYXNlIGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYW4gZXhwbGljaXQgc2VhcmNoIHJvb3QsIGV4YWN0bHkgYXNcbiAgLy8gaGFzR3JlcEZpbGVPcGVyYW5kIHRyZWF0cyBhIGdyZXAtZmFtaWx5IHBpcGVsaW5lIHN0YWdlLiBHaXQgcGF0aHNwZWNcbiAgLy8gbWFnaWMgaXMgbm90IGEgZmlsZXN5c3RlbSBwYXRoIGFuZCBuZXZlciBiZWNvbWVzIGEgcm9vdCBcdTIwMTQgYnV0IGl0c1xuICAvLyBwcmVzZW5jZSBpcyB0cmFja2VkLCBiZWNhdXNlIGl0IG1ha2VzIGdpdCBncmVwIHNlYXJjaCB0aGUgd2hvbGUgdHJlZVxuICAvLyBmcm9tIGEgc3ViZGlyLlxuICBjb25zdCBmaXJzdFBvc2l0aW9uYWwgPSBwYXR0ZXJuRnJvbUZsYWcgPyAwIDogMTtcbiAgY29uc3QgcGF0aEFyZ3MgPVxuICAgIHBvc2l0aW9uYWxzLmxlbmd0aCA+IGZpcnN0UG9zaXRpb25hbCA/IHBvc2l0aW9uYWxzLnNsaWNlKGZpcnN0UG9zaXRpb25hbCkuZmlsdGVyKChwKSA9PiAhaXNQYXRoc3BlY01hZ2ljKHApKSA6IFtdO1xuICBjb25zdCBwYXRoc3BlY01hZ2ljID1cbiAgICBwb3NpdGlvbmFscy5sZW5ndGggPiBmaXJzdFBvc2l0aW9uYWwgJiYgcG9zaXRpb25hbHMuc2xpY2UoZmlyc3RQb3NpdGlvbmFsKS5zb21lKChwKSA9PiBpc1BhdGhzcGVjTWFnaWMocCkpO1xuICByZXR1cm4geyBwYXRoQXJncywgY29udGV4dEZsYWdzLCBudW1iZXJlZCwgd2l0aEZpbGVuYW1lLCBwYXRoc3BlY01hZ2ljLCBzdGRpblJlZGlyZWN0IH07XG59XG5cbmludGVyZmFjZSBHaXRTdWJjb21tYW5kSW5mbyB7XG4gIC8qKiBUaGUgYGdpdCAtQ2AgZGlyZWN0b3J5LCB3aGVuIHByZXNlbnQgYW5kIHN0YXRpY2FsbHkgcmVzb2x2YWJsZS4gKi9cbiAgZGlyOiBzdHJpbmcgfCBudWxsO1xuICBkaXJVbnJlc29sdmFibGU6IGJvb2xlYW47XG4gIC8qKiBUaGUgc3ViY29tbWFuZCB0b2tlbiAoYGdyZXBgLCBgZGlmZmAsIGBzaG93YCwgYGxvZ2AsIGBibGFtZWAsIFx1MjAyNikuICovXG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgLyoqIEluZGV4IGp1c3QgcGFzdCB0aGUgc3ViY29tbWFuZCwgd2hlcmUgaXRzIGFyZ3YgYmVnaW5zLiAqL1xuICBzdGFydDogbnVtYmVyO1xufVxuXG4vKipcbiAqIExvY2F0ZSB0aGUgc3ViY29tbWFuZCB0b2tlbiBvZiBhIGBnaXRgIGNvbW1hbmQsIGhvbm9yaW5nIGAtQ2AvYC1jYCBsaWtlXG4gKiBwYXJzZS1jb21tYW5kLnRzJ3MgZmluZEdpdFN1YmNvbW1hbmQuIFJldHVybnMgbnVsbCB3aGVuIG5vIHN1YmNvbW1hbmRcbiAqIHRva2VuIGFwcGVhcnMgKGJhcmUgYGdpdGApLiBXaGljaCBzdWJjb21tYW5kcyByZXNwb25zZS1kZWNvZGUgaXMgdGhlXG4gKiBnYXRlJ3MgY2FsbCwgbm90IHRoaXMgc2Nhbm5lcidzLlxuICovXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChhcmd2OiBzdHJpbmdbXSk6IEdpdFN1YmNvbW1hbmRJbmZvIHwgbnVsbCB7XG4gIGxldCBkaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgZGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMTtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gYXJndltpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgZGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgZGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IGRpciwgZGlyVW5yZXNvbHZhYmxlLCBzdWJjb21tYW5kOiBhLCBzdGFydDogaSArIDEgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIEEgcmVzcG9uc2UtZGVyaXZhYmxlIGNvbW1hbmQgdGhhdCBwYXNzZWQgdGhlIGdhdGUsIHdpdGggaXRzIGRlY29kZXIncyBpbnB1dHMuICovXG50eXBlIEdhdGVkQ29tbWFuZCA9IHtcbiAga2luZDogJ3NlYXJjaCcgfCAnZGlmZicgfCAnYmxhbWUnO1xuICBhcmd2OiBzdHJpbmdbXTtcbiAgLyoqIEluZGV4IGp1c3QgcGFzdCB0aGUgYmluYXJ5IChzZWFyY2gpIG9yIHN1YmNvbW1hbmQgKGdpdCksIHdoZXJlIGl0cyBhcmd2IGJlZ2lucy4gKi9cbiAgc3RhcnQ6IG51bWJlcjtcbiAgLyoqIFRoZSBgZ2l0IC1DYCBkaXJlY3RvcnksIHdoZW4gcHJlc2VudCBhbmQgc3RhdGljYWxseSByZXNvbHZhYmxlLiAqL1xuICBkaXI6IHN0cmluZyB8IG51bGw7XG4gIGRpclVucmVzb2x2YWJsZTogYm9vbGVhbjtcbn07XG5cbi8qKiBXaGV0aGVyIGEgYGdpdCBsb2dgIGludm9jYXRpb24gaXMgZGlmZi1mb3JtIChgLXBgL2AtLXBhdGNoYCBwcmVzZW50KS4gKi9cbmZ1bmN0aW9uIGhhc0RpZmZQYXRjaEZsYWcoYXJndjogc3RyaW5nW10sIHN0YXJ0OiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGlmIChhcmd2W2ldID09PSAnLXAnIHx8IGFyZ3ZbaV0gPT09ICctLXBhdGNoJykgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IHNob3dgIGludm9jYXRpb24gaXMgdGhlIGA8cmV2Pjo8cGF0aD5gIGNvbnRlbnQgaWRpb20gd2hvc2VcbiAqIHN0ZG91dCBpcyB0aGUgYmxvYidzIFJBVyBjb250ZW50LCBuZXZlciBkaWZmLWZvcm0uIGBnaXQgc2hvd2AgcG9zaXRpb25hbHNcbiAqIGFyZSByZXZpc2lvbnMsIGFuZCBvbmx5IGEgcmV2OnBhdGggc3BlYyBlbWJlZHMgYSBjb2xvbiBcdTIwMTQgYSBkaWZmLXNoYXBlZFxuICogdmVuZG9yZWQgYmxvYiAoYSAucGF0Y2gsIGEgZm9ybWF0LXBhdGNoIGFyY2hpdmUpIG11c3Qgbm90IGRlY29kZSBpbnRvXG4gKiBmYWJyaWNhdGVkIHRvdWNoZXMgb24gdGhlIGZpbGVzIGl0cyBjb250ZW50IG5hbWVzLiBPcHRpb24gdmFsdWVzIGFyZVxuICogc2tpcHBlZCBzbyBgLS1mb3JtYXQgJUg6JXNgICh3aGljaCBsZWdpdGltYXRlbHkgY29udGFpbnMgYSBjb2xvbikgY2Fubm90XG4gKiBmYWxzZS1wb3NpdGl2ZTsgYWZ0ZXIgYC0tYCB0aGUgdG9rZW5zIGFyZSBsaXRlcmFsIHBhdGhzcGVjcywgbm90IHJldnMuXG4gKiBPbmx5IGZsYWdzIHRoYXQgY29uc3VtZSBhIFNFUEFSQVRFIGFyZ3VtZW50IHNraXAgdGhlaXIgdmFsdWU6IGAtLXN0YXRgIGFuZFxuICogYC0tZGlyc3RhdGAgdGFrZSB0aGVpcnMgdmlhIGA9YCAoYC0tZGlyc3RhdD1maWxlcywxMGApIG9yIG5vdCBhdCBhbGwsIHNvIGFcbiAqIGBnaXQgc2hvdyAtLXN0YXQgPHJldj46PHBhdGg+YCBtdXN0IG5vdCBzd2FsbG93IHRoZSByZXY6cGF0aCBhcyBhIHZhbHVlLlxuICovXG5mdW5jdGlvbiBoYXNSZXZQYXRoQXJnKGFyZ3Y6IHN0cmluZ1tdLCBzdGFydDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGNvbnN0IHZhbHVlRmxhZ3MgPSBuZXcgU2V0KFsnLS1mb3JtYXQnLCAnLS1wcmV0dHknLCAnLS1vdXRwdXQnLCAnLS13b3JkLWRpZmYtcmVnZXgnXSk7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSAmJiBhICE9PSAnLScpIHtcbiAgICAgIGlmICghYS5pbmNsdWRlcygnPScpICYmIHZhbHVlRmxhZ3MuaGFzKGEpKSBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuaW5jbHVkZXMoJzonKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGV4YWN0IGxvbmcgZmxhZyBgZmxhZ2AgYXBwZWFycyBpbiB0aGUgY29tbWFuZCdzIGFyZ3YgKHN0b3BwaW5nXG4gKiBhdCBgLS1gLCBhZnRlciB3aGljaCB0b2tlbnMgYXJlIGxpdGVyYWwgcGF0aHNwZWNzLCBub3Qgb3B0aW9ucykuIFVzZWQgZm9yXG4gKiB0aGUgZGlmZiBgLS1yZWxhdGl2ZWAgYW5kIGdpdC1ncmVwIGAtLWZ1bGwtbmFtZWAgY2FydmUtb3V0cy5cbiAqL1xuZnVuY3Rpb24gaGFzRmxhZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgZmxhZzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChhID09PSBmbGFnKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBhIGBnaXQgZGlmZmAgaW52b2NhdGlvbidzIHBvc2l0aW9uYWwgYXJndW1lbnRzIGNhcnJ5IGByZXY6cGF0aGBcbiAqIHNwZWNzLiBgZ2l0IGRpZmYgPHJldj46PHBhdGg+IDxyZXY+OjxwYXRoPmAgY29tcGFyZXMgdHdvIGhpc3RvcmljYWwgYmxvYnNcbiAqIGFuZCBlbWl0cyBhIG5vcm1hbCB1bmlmaWVkIGRpZmYgd2hvc2UgcGF0aHMgbmFtZSB0aGUgYmxvYiBwYXRocywgbm90XG4gKiB3b3JraW5nLXRyZWUgZmlsZXMgXHUyMDE0IGRlY29kaW5nIGl0IGZhYnJpY2F0ZXMgdG91Y2hlcyBvbiBhIGZpbGUgZ2l0IG5ldmVyXG4gKiByZWFkICh1bmxpa2UgdGhlIHNpbmdsZS1hcmcgZm9ybSwgd2hpY2ggZXJyb3JzIGluc3RlYWQgb2YgZW1pdHRpbmdcbiAqIGNvbnRlbnQpLiBBIHBvc2l0aW9uYWwgY29udGFpbmluZyBgOmAgaXMgYSByZXY6cGF0aCB1bmxlc3MgYW4gZXhpc3RpbmdcbiAqIGZpbGUgY2FycmllcyB0aGF0IGxpdGVyYWwgbmFtZSAoYGdpdCBkaWZmIC4vd2VpcmQ6bmFtZS50c2AgXHUyMDE0IGEgbGl0ZXJhbFxuICogY29sb24gcGF0aCBuZWVkcyB0aGUgYC4vYCBwcmVmaXggdG8gc3Vydml2ZSBnaXQncyByZXZpc2lvbiBwYXJzaW5nKTtcbiAqIGFmdGVyIGAtLWAgdGhlIHRva2VucyBhcmUgbGl0ZXJhbCBwYXRoc3BlY3MgYW5kIHRoZSBzY2FuIHN0b3BzLiBGbGFnc1xuICogdGhhdCBjb25zdW1lIGEgU0VQQVJBVEUgYXJndW1lbnQgc2tpcCB0aGVpciB2YWx1ZSBzbyBhbiBvdXRwdXQgcGF0aFxuICogY2Fubm90IGZhbHNlLXBvc2l0aXZlLlxuICovXG5mdW5jdGlvbiBoYXNEaWZmUmV2UGF0aEFyZyhhcmd2OiBzdHJpbmdbXSwgc3RhcnQ6IG51bWJlciwgY3dkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gVmFsdWUtY29uc3VtaW5nIGZsYWdzIHdob3NlIFNFUEFSQVRFIHZhbHVlIHRva2VuIG11c3QgbmV2ZXIgYmUgc2Nhbm5lZFxuICAvLyBhcyBhIHBvc2l0aW9uYWw6IGAtTCA8cmFuZ2U+OjxmaWxlPmAgKGdpdCBsb2cvYmxhbWUgXHUyMDE0IHRoZSByYW5nZSdzIGA6YCBpc1xuICAvLyBhIGxpbmUtcmFuZ2Ugc2VwYXJhdG9yLCBub3QgYSByZXY6cGF0aCksIHRoZSBwaWNrYXhlIGAtU2AvYC1HYCBhbmQgdGhlXG4gIC8vIGxvZyBmaWx0ZXJzIGAtLWdyZXBgL2AtLWF1dGhvcmAvYC0tY29tbWl0dGVyYCwgYW5kIHRoZSBkYXRlIGxpbWl0c1xuICAvLyBgLS1zaW5jZWAvYC0tdW50aWxgL2AtLWJlZm9yZWAvYC0tYWZ0ZXJgLCB3aG9zZSBzcGFjZS1mb3JtIElTTyB0aW1lc3RhbXBcbiAgLy8gdmFsdWVzIChgLS1zaW5jZSAnMjAyNC0wMS0wMVQxMjowMDowMCdgKSBjb250YWluIGNvbG9ucyBcdTIwMTQgYVxuICAvLyBgZ2l0IGxvZyAtcCAtUyAnOmF1dGgnYCBhcmNoYWVvbG9neSBpbnZvY2F0aW9uIGlzIGV4aXQtMCB2YWxpZCBhbmQgaXRzXG4gIC8vIHZhbHVlIHRva2VuIG11c3Qgbm90IHJlamVjdCB0aGUgd2hvbGUgZGVjb2RlLiBFeGFjdC10b2tlbiBtZW1iZXJzaGlwXG4gIC8vIGtlZXBzIGdsdWVkIGZvcm1zIHNhZmUgYnkgY29uc3RydWN0aW9uOiBgLVM6YXV0aGAgaXMgbmV2ZXIgaW4gdGhlIHNldFxuICAvLyBhbmQgc2tpcHMgbm8gdG9rZW4uXG4gIGNvbnN0IHZhbHVlRmxhZ3MgPSBuZXcgU2V0KFtcbiAgICAnLS1vdXRwdXQnLFxuICAgICctLXNyYy1wcmVmaXgnLFxuICAgICctLWRzdC1wcmVmaXgnLFxuICAgICctTCcsXG4gICAgJy1TJyxcbiAgICAnLUcnLFxuICAgICctLWdyZXAnLFxuICAgICctLWF1dGhvcicsXG4gICAgJy0tY29tbWl0dGVyJyxcbiAgICAnLS1zaW5jZScsXG4gICAgJy0tdW50aWwnLFxuICAgICctLWJlZm9yZScsXG4gICAgJy0tYWZ0ZXInXG4gIF0pO1xuICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nKSB7XG4gICAgICBpZiAoIWEuaW5jbHVkZXMoJz0nKSAmJiB2YWx1ZUZsYWdzLmhhcyhhKSkgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLmluY2x1ZGVzKCc6JykgJiYgIWV4aXN0c1N5bmMocmVzb2x2ZVBhdGgoY3dkLCBhKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUaGUgcGF0aCBiYXNlIGBnaXQgZGlmZiAtLXJlbGF0aXZlWz08cGF0aD5dYCBhbmNob3JzIGl0cyBvdXRwdXQgdG86IG51bGxcbiAqIHdoZW4gdGhlIGZsYWcgaXMgYWJzZW50IChyZXBvLXJvb3QtcmVsYXRpdmUgcGF0aHMgXHUyMDE0IHRoZSBkZWZhdWx0KTsgdGhlXG4gKiBlZmZlY3RpdmUgZGlyIGZvciB0aGUgYmFyZSBmb3JtLCB3aG9zZSBwYXRocyBhcmUgY3dkLXJlbGF0aXZlIGFuZCBleGNsdWRlXG4gKiBjaGFuZ2VzIG91dHNpZGUgdGhlIGN3ZDsgb3IgYDxwYXRoPmAgcmVzb2x2ZWQgYWdhaW5zdCB0aGUgd29ya3RyZWUgcm9vdFxuICogZm9yIHRoZSB2YWx1ZSBmb3JtICh2ZXJpZmllZCBhZ2FpbnN0IGdpdCAyLjQ3LjMgXHUyMDE0IHRoZSB2YWx1ZSBpc1xuICogcm9vdC1yZWxhdGl2ZSwgbm90IGN3ZC1yZWxhdGl2ZSkuIGAndW5yZXNvbHZhYmxlJ2Agd2hlbiB0aGUgdmFsdWUgZm9ybSdzXG4gKiBwYXRoIGNhbm5vdCBiZSBzdGF0aWNhbGx5IHJlc29sdmVkIChzaGVsbCBleHBhbnNpb24pIG9yIG5vIHdvcmt0cmVlIHJvb3RcbiAqIGV4aXN0cyBcdTIwMTQgZmFpbCBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGRpZmZSZWxhdGl2ZUJhc2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBzdGFydDogbnVtYmVyLFxuICBlZmZlY3RpdmVEaXI6IHN0cmluZyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyB8IG51bGxcbik6IHsgYmFzZTogc3RyaW5nOyByb290OiBzdHJpbmcgfSB8ICd1bnJlc29sdmFibGUnIHwgbnVsbCB7XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykgcmV0dXJuIG51bGw7XG4gICAgaWYgKGEgPT09ICctLXJlbGF0aXZlJykgcmV0dXJuIHsgYmFzZTogZWZmZWN0aXZlRGlyLCByb290OiBlZmZlY3RpdmVEaXIgfTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXJlbGF0aXZlPScpKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGEuc2xpY2UoJy0tcmVsYXRpdmU9Jy5sZW5ndGgpO1xuICAgICAgaWYgKHJlcG9Sb290ID09PSBudWxsIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHZhbHVlKSB8fCB2YWx1ZSA9PT0gJycpIHJldHVybiAndW5yZXNvbHZhYmxlJztcbiAgICAgIGNvbnN0IGJhc2UgPSByZXNvbHZlUGF0aChyZXBvUm9vdCwgdmFsdWUpO1xuICAgICAgcmV0dXJuIHsgYmFzZSwgcm9vdDogYmFzZSB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBQb3N0LWdhdGVkIHBpcGVsaW5lIHN0YWdlcyB0aGF0IHByb3ZhYmx5IG9ubHkgdHJ1bmNhdGUsIHJlb3JkZXIsIG9yXG4gKiBkZWR1cGUgdGhlIGVhcmxpZXIgc3RhZ2UncyByZWNvcmRzIFx1MjAxNCBlYWNoIHN1cnZpdmluZyBsaW5lJ3MgY29udGVudCBpc1xuICogYnl0ZS12ZXJiYXRpbSwgc28gdGhlIGRlY29kZWQgc3BhbnMgc3RheSBnZW51aW5lLiBUaGUgdW5jb25kaXRpb25hbFxuICogbWVtYmVycyBvZiB0aGUgY2xvc2FibGUgYWxsb3dsaXN0IGZvciB0aGUgaW52ZXJ0ZWQgZGVmYXVsdCBvZlxuICogaXNSZW51bWJlcmluZ0ZpbHRlcjsgdGhlIGNvbmRpdGlvbmFsIGNhcnZlLW91dHMgKHNlZC9hd2svcGVybC90ciB3aXRoXG4gKiBhbGxvd2xpc3RlZCBzY3JpcHRzKSBhcmUgaGFuZGxlZCBieSB0aGVpciBvd24gc3RhZ2UgY2hlY2tzIGJlbG93LiBFdmVyeVxuICogYWxsb3dsaXN0ZWQgc3RhZ2UgaXMgYWRkaXRpb25hbGx5IHJlcXVpcmVkIHRvIGNhcnJ5IG5vIGZpbGUgb3BlcmFuZHNcbiAqIChoYXNGaWxlT3BlcmFuZCkgXHUyMDE0IGEgdG9rZW4gdGhhdCBpcyBub3QgYSBmbGFnIG5hbWVzIGEgZmlsZSB0aGUgc3RhZ2VcbiAqIHJlYWRzIGluc3RlYWQgb2YgdGhlIHBpcGUuXG4gKi9cbmNvbnN0IFZFUkJBVElNX1BBU1NfQklOUyA9IG5ldyBTZXQoWydoZWFkJywgJ3RhaWwnLCAnd2MnLCAnc29ydCcsICd1bmlxJywgJ2N1dCddKTtcblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1maXJzdC1nYXRlZC1zdGFnZSBwaXBlbGluZSBzdGFnZSByZW51bWJlcnMgb3IgcmVzdHJ1Y3R1cmVzXG4gKiB0aGUgZWFybGllciBzdGFnZSdzIHJlY29yZHMgc28gdGhlIHJlc3BvbnNlIG5vIGxvbmdlciBjYXJyaWVzIHRoZSBmaWxlXG4gKiBsaW5lcyB0aGUgZ2F0ZWQgc3RhZ2UgcHJvZHVjZWQuIFRoZSBERUZBVUxUIElTIElOVkVSVEVEIChmYWlsIGNsb3NlZCk6XG4gKiBhIHN0YWdlIGlzIGFsbG93ZWQgb25seSB3aGVuIGl0IGlzIHByb3ZhYmx5IHZlcmJhdGltIFx1MjAxNCByZW51bWJlcmluZyBpcyBhXG4gKiBwcm9wZXJ0eSBvZiB0aGUgYmluYXJ5LCBhbmQgdGhlIHJlbnVtYmVyZXIgc2V0IChwZXJsLCBweXRob24sIHJ1YnksIG1hd2ssXG4gKiBnYXdrLCBuYXdrLCB0ciwgcGFzdGUsIFx1MjAyNikgaXMgdW5ib3VuZGVkLCBzbyBhIGRlbnkgbGlzdCBjYW4gbmV2ZXIgYmVcbiAqIGNsb3NlZCBhbmQgYW55IGJpbiBvdXRzaWRlIHRoZSBhbGxvd2xpc3QgaXMgdHJlYXRlZCBhcyBhIHJlbnVtYmVyZXIuXG4gKiBUaGUgYWxsb3dsaXN0IGlzIHBpcGVsaW5lLXNoYXBlIG9ubHkgKGEgcmVudW1iZXJlZCByZWNvcmQgaXMgYnl0ZS1cbiAqIGlkZW50aWNhbCB0byBsZWdpdCBvdXRwdXQsIHNvIGNvbnRlbnQvcmVjb3JkLXNoYXBlIGRpc2NyaW1pbmF0aW9uIGlzXG4gKiB1bnNvdW5kKTogZ3JlcC9lZ3JlcC9mZ3JlcC9yZyBXSVRIT1VUIG51bWJlcmVkIGV2aWRlbmNlXG4gKiAoYC1uYC9gLS1saW5lLW51bWJlcmAgXHUyMDE0IGEgcGxhaW4gZmlsdGVyIHBhc3NlcyByZWNvcmRzIHRocm91Z2ggdmVyYmF0aW0pXG4gKiBhbmQgV0lUSE9VVCBmaWxlIG9wZXJhbmRzIGJleW9uZCB0aGUgcGF0dGVybiBzbG90LCBwbGFpbiBgY2F0YCAobm9cbiAqIGAtbmAvYC0tbnVtYmVyYCwgbm8gZmlsZSBvcGVyYW5kcyksIGhlYWQvdGFpbC93Yy9zb3J0L3VuaXEvY3V0XG4gKiAodHJ1bmNhdGUvcmVvcmRlci9kZWR1cGUsIG5vIGZpbGUgb3BlcmFuZHMpLCBhbmQgYHNlZGAvYGF3a2AvYHBlcmxgL2B0cmBcbiAqIHdob3NlIHNjcmlwdC9wcm9ncmFtIHByb3ZhYmx5IHBhc3NlcyB3aG9sZSByZWNvcmRzIHRocm91Z2ggYnl0ZS12ZXJiYXRpbVxuICogKGlzVmVyYmF0aW1TZWRTdGFnZSAvIGlzVmVyYmF0aW1Bd2tTdGFnZSAvIGlzVmVyYmF0aW1QZXJsU3RhZ2UgL1xuICogaXNWZXJiYXRpbVRyU3RhZ2UgXHUyMDE0IG51bWVyaWMtYWRkcmVzcyBgcGAvYHFgL2BkYCBmb3JtcywgY29uZGl0aW9uLW9ubHlcbiAqIE5SLWNvbXBhcmlzb24vcGFyaXR5IHByb2dyYW1zLCBzdHJlYW0tcG9zaXRpb24gYHByaW50IGlmL3VubGVzcyAkLiBOIGRgXG4gKiBwZXJsIHNjcmlwdHMsIGFuZCBkaWdpdC9jb2xvbi9uZXdsaW5lLWZyZWUgYHRyIC1kYCBkZWxldGlvbnMgb3V0cHV0IHRoZVxuICogc2FtZSBieXRlcyB0aGUgZWFybGllciBzdGFnZSBlbWl0dGVkLCBzbyB0aGUgZGVjb2RlZCBzcGFucyBzdGF5XG4gKiBnZW51aW5lKS4gQSBGSUxFIE9QRVJBTkQgXHUyMDE0IGEgdG9rZW4gdGhhdCBpcyBub3QgYSBmbGFnIFx1MjAxNCBtYWtlcyB0aGUgc3RhZ2VcbiAqIHJlYWQgdGhhdCBmaWxlIGluc3RlYWQgb2YgdGhlIHBpcGU6IHRoZSByZXNwb25zZSdzIHJlY29yZHMgdGhlbiBjb21lXG4gKiBmcm9tIHRoZSBmaWxlLCBub3QgdGhlIGdhdGVkIHN0YWdlLCBhbmQgYSBjcmFmdGVkIHJlY29yZCBkZWNvZGVzIGFzIGFcbiAqIHBoYW50b20gdG91Y2gsIHNvIGV2ZXJ5IGFsbG93bGlzdGVkIGJpbiBmYWlscyBjbG9zZWQgb24gZmlsZSBvcGVyYW5kc1xuICogKHRoZSBzY3JpcHRlZCBiaW5zIGJ5IGFyZ3Ytc2hhcGUsIHRoZSByZXN0IHZpYSBoYXNGaWxlT3BlcmFuZCkuIGBubGBcbiAqIGFsd2F5cyByZW51bWJlcnMuXG4gKi9cbmZ1bmN0aW9uIGlzUmVudW1iZXJpbmdGaWx0ZXIoYXJndjogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgY29uc3QgYmluID0gYXJndlswXTtcbiAgaWYgKGJpbiA9PT0gJ25sJykgcmV0dXJuIHRydWU7XG4gIGlmIChiaW4gPT09ICdzZWQnKSByZXR1cm4gIWlzVmVyYmF0aW1TZWRTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ2F3aycpIHJldHVybiAhaXNWZXJiYXRpbUF3a1N0YWdlKGFyZ3YpO1xuICBpZiAoYmluID09PSAncGVybCcpIHJldHVybiAhaXNWZXJiYXRpbVBlcmxTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ3RyJykgcmV0dXJuICFpc1ZlcmJhdGltVHJTdGFnZShhcmd2KTtcbiAgaWYgKGJpbiA9PT0gJ2NhdCcpIHtcbiAgICBpZiAoYXJndi5zb21lKChhKSA9PiBhID09PSAnLS1udW1iZXInIHx8IChhLnN0YXJ0c1dpdGgoJy0nKSAmJiAhYS5zdGFydHNXaXRoKCctLScpICYmIGEuaW5jbHVkZXMoJ24nKSkpKVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIGhhc0ZpbGVPcGVyYW5kKGFyZ3YpO1xuICB9XG4gIGlmIChTRUFSQ0hfQklOUy5oYXMoYmluKSkge1xuICAgIGlmIChhcmd2LnNvbWUoKGEpID0+IGEgPT09ICctLWxpbmUtbnVtYmVyJyB8fCAoYS5zdGFydHNXaXRoKCctJykgJiYgIWEuc3RhcnRzV2l0aCgnLS0nKSAmJiBhLmluY2x1ZGVzKCduJykpKSlcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBoYXNHcmVwRmlsZU9wZXJhbmQoYXJndik7XG4gIH1cbiAgLy8gVGhlIGludmVydGVkIGRlZmF1bHQ6IGFueSBiaW4gb3V0c2lkZSB0aGUga25vd24tdmVyYmF0aW0gYWxsb3dsaXN0XG4gIC8vIChoZWFkL3RhaWwvd2Mvc29ydC91bmlxL2N1dCkgZmFpbHMgY2xvc2VkIFx1MjAxNCBhbmQgdGhlIGFsbG93bGlzdCBiaW5zXG4gIC8vIHRoZW1zZWx2ZXMgZmFpbCBjbG9zZWQgb24gZmlsZSBvcGVyYW5kcy5cbiAgaWYgKFZFUkJBVElNX1BBU1NfQklOUy5oYXMoYmluKSkgcmV0dXJuIGhhc0ZpbGVPcGVyYW5kKGFyZ3YpO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGFueSBhcmd2IHRva2VuIGlzIGEgRklMRSBPUEVSQU5EIGZvciBhIHN0YWdlIHRoYXQgb3RoZXJ3aXNlIHJlYWRzXG4gKiB0aGUgcGlwZS4gQSB0b2tlbiB0aGF0IGlzIG5vdCBhIGZsYWcgbmFtZXMgYSBmaWxlIChhZnRlciB0aGUgYC0tYFxuICogdGVybWluYXRvciBldmVyeSB0b2tlbiBpcyBhIHBvc2l0aW9uYWwsIHNpbmNlIG9wdGlvbiBwYXJzaW5nIGhhcyBlbmRlZCk7XG4gKiBgLWAgbmFtZXMgc3RkaW4sIHdoaWNoIGlzIHRoZSBwaXBlIGl0c2VsZiwgYW5kIGAtLWAgaXMgb25seSB0aGVcbiAqIHRlcm1pbmF0b3IgXHUyMDE0IGJvdGggc3RheSBvcGVuLiBFeGFtcGxlOiBgcmcgLW4gbmVlZGxlIGYgfCBoZWFkIC0yYCBjYXJyaWVzXG4gKiBubyBmaWxlIG9wZXJhbmQgYW5kIHBhc3NlcyB2ZXJiYXRpbSwgYnV0IGByZyAtbiBuZWVkbGUgZiB8IGhlYWQgLTJcbiAqIGNyYWZ0ZWQudHh0YCByZWFkcyBjcmFmdGVkLnR4dCBpbnN0ZWFkIG9mIHRoZSBwaXBlIFx1MjAxNCBpdHMgcmVjb3JkcyBhcmUgbm90XG4gKiB0aGUgZ2F0ZWQgc3RhZ2Uncywgc28gdGhlIHBpcGVsaW5lIG11c3QgZmFpbCBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGhhc0ZpbGVPcGVyYW5kKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGxldCBhZnRlclRlcm1pbmF0b3IgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyVGVybWluYXRvciA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykgY29udGludWU7IC8vIHN0ZGluIFx1MjAxNCB0aGUgcGlwZVxuICAgIGlmIChhZnRlclRlcm1pbmF0b3IgfHwgIWEuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogV2hldGhlciBhIGdyZXAtZmFtaWx5IHN0YWdlJ3MgYXJndiBuYW1lcyBhIEZJTEUgT1BFUkFORCBcdTIwMTQgdGhlIHN0YWdlIHRoZW5cbiAqIHJlYWRzIHRoYXQgZmlsZSBpbnN0ZWFkIG9mIHRoZSBwaXBlLiBXaXRob3V0IGAtZWAvYC1mYCB0aGUgZmlyc3RcbiAqIHBvc2l0aW9uYWwgaXMgdGhlIFBBVFRFUk4gKGByZyBuZWVkbGVgL2BncmVwIG5lZWRsZWAgaW4gYSBwaXBlbGluZSByZWFkc1xuICogc3RkaW4gYW5kIHBhc3NlcyByZWNvcmRzIHRocm91Z2ggdmVyYmF0aW0pLCBzbyBhIGZpbGUgb3BlcmFuZCBpcyBhbnlcbiAqIHBvc2l0aW9uYWwgQkVZT05EIHRoZSBwYXR0ZXJuIHNsb3Q7IHdpdGggdGhlIHBhdHRlcm4gY29taW5nIGZyb20gYSBmbGFnXG4gKiB2YWx1ZSAoYC1lIFBBVGAsIGAtZiBQQVRGSUxFYCwgYC0tcmVnZXhwYCwgYC0tZmlsZWAsIGdsdWVkIGAtZVBBVGAgL1xuICogYC1mUEFURklMRWAgLyBgLS1yZWdleHA9UEFUYCAvIGAtLWZpbGU9UEFURklMRWApIGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYVxuICogZmlsZS4gVGhlIHZhbHVlcyBjb25zdW1lZCBieSBgLWVgL2AtZmAgYW5kIHRoZWlyIGxvbmcgZm9ybXMgYXJlIHBhdHRlcm5cbiAqIHNvdXJjZXMgXHUyMDE0IG5ldmVyIGZpbGUgb3BlcmFuZHMuXG4gKi9cbmZ1bmN0aW9uIGhhc0dyZXBGaWxlT3BlcmFuZChhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBsZXQgcGF0dGVybkZyb21GbGFnID0gZmFsc2U7XG4gIGxldCBzZWVuUGF0dGVybiA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMTsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgLy8gT3B0aW9uIHBhcnNpbmcgZW5kczsgZXZlcnkgcmVtYWluaW5nIHRva2VuIGlzIGEgcG9zaXRpb25hbC5cbiAgICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGFyZ3YubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKCFwYXR0ZXJuRnJvbUZsYWcgJiYgIXNlZW5QYXR0ZXJuKSBzZWVuUGF0dGVybiA9IHRydWU7XG4gICAgICAgIGVsc2UgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnIHx8IGEgPT09ICctZicgfHwgYSA9PT0gJy0tcmVnZXhwJyB8fCBhID09PSAnLS1maWxlJykge1xuICAgICAgcGF0dGVybkZyb21GbGFnID0gdHJ1ZTtcbiAgICAgIGkrKzsgLy8gY29uc3VtZSB0aGUgdmFsdWUgdG9rZW4gKHRoZSBwYXR0ZXJuIG9yIHRoZSBwYXR0ZXJuIGZpbGUpXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctLScpKSB7XG4gICAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tcmVnZXhwPScpIHx8IGEuc3RhcnRzV2l0aCgnLS1maWxlPScpKSBwYXR0ZXJuRnJvbUZsYWcgPSB0cnVlO1xuICAgICAgfSBlbHNlIGlmIChhLmxlbmd0aCA+IDIgJiYgKGFbMV0gPT09ICdlJyB8fCBhWzFdID09PSAnZicpKSB7XG4gICAgICAgIHBhdHRlcm5Gcm9tRmxhZyA9IHRydWU7IC8vIGdsdWVkIHNob3J0IHZhbHVlIGZvcm06IC1lUEFUIC8gLWZQQVRGSUxFXG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFwYXR0ZXJuRnJvbUZsYWcgJiYgIXNlZW5QYXR0ZXJuKSBzZWVuUGF0dGVybiA9IHRydWU7XG4gICAgZWxzZSByZXR1cm4gdHJ1ZTsgLy8gYSBwb3NpdGlvbmFsIGJleW9uZCB0aGUgcGF0dGVybiBpcyBhIGZpbGUgb3BlcmFuZFxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBzY3JpcHRgIHByb3ZhYmx5IHByaW50cyBvciBvbWl0cyB3aG9sZSBpbnB1dCByZWNvcmRzIGJ5dGUtXG4gKiB2ZXJiYXRpbSAobnVtZXJpYyBhZGRyZXNzZXMgb25seSkuIFdpdGggYC1uYCAoYXV0by1wcmludCBzdXBwcmVzc2VkKSB0aGVcbiAqIHNjcmlwdCBtdXN0IGV4cGxpY2l0bHkgcHJpbnQ6IGBwYCAoc2luZ2xlIHJlY29yZCksIGAscGAgKGEgcmVjb3JkIHJhbmdlKSxcbiAqIG9yIGAsJHBgIChhIHJlY29yZCB0byB0aGUgZW5kKS4gV2l0aG91dCBgLW5gIHRoZSBkZWZhdWx0IGF1dG8tcHJpbnQga2VlcHNcbiAqIHJlY29yZHMgdmVyYmF0aW0sIHNvIGBxYCAocXVpdCBhZnRlciBhIHJlY29yZCBcdTIwMTQgYSBwcmVmaXggY3V0KSBhbmQgYGRgXG4gKiAoZGVsZXRlIGEgc2luZ2xlIHJlY29yZCBcdTIwMTQgYSBzdWJzZXQgY3V0KSBxdWFsaWZ5LiBQYXR0ZXJuIGFkZHJlc3NlcyBhbmRcbiAqIGFueSByZXdyaXRlIGNvbW1hbmQgKGBzLy8vYCwgYHkvLy9gLCBgPWAsIGBhYC9gaWAvYGNgKSBjaGFuZ2Ugb3IgaW5zZXJ0XG4gKiByZWNvcmQgY29udGVudCBhbmQgYXJlIG5ldmVyIGFsbG93bGlzdGVkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltU2VkU2NyaXB0KHNjcmlwdDogc3RyaW5nLCBzdXBwcmVzc0F1dG9QcmludDogYm9vbGVhbik6IGJvb2xlYW4ge1xuICBpZiAoc3VwcHJlc3NBdXRvUHJpbnQpIHtcbiAgICByZXR1cm4gL15cXGQrcCQvLnRlc3Qoc2NyaXB0KSB8fCAvXlxcZCssXFxkK3AkLy50ZXN0KHNjcmlwdCkgfHwgL15cXGQrLFxcJHAkLy50ZXN0KHNjcmlwdCk7XG4gIH1cbiAgcmV0dXJuIC9eXFxkK3EkLy50ZXN0KHNjcmlwdCkgfHwgL15cXGQrZCQvLnRlc3Qoc2NyaXB0KTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgc2VkYCBzdGFnZSdzIHdob2xlIGFyZ3YgcHJvdmFibHkgcGFzc2VzIHRoZSBlYXJsaWVyXG4gKiByZWNvcmRzIHRocm91Z2ggYnl0ZS12ZXJiYXRpbS4gVGhlIHNjcmlwdCBtdXN0IGJlIHRoZSBmaXJzdCBub24tZmxhZ1xuICogcG9zaXRpb25hbDsgb25seSBgLW5gIG1heSBwcmVjZWRlIGl0LCBhbmQgYW55IGZ1cnRoZXIgcG9zaXRpb25hbCAoYVxuICogc2Vjb25kIHNjcmlwdCwgb3IgZmlsZSBhcmdzIFx1MjAxNCB0aGUgc3RhZ2UgdGhlbiByZWFkcyBmaWxlcywgbm90IHRoZSBwaXBlKVxuICogZmFpbHMgY2xvc2VkLiBBbnkgb3RoZXIgZmxhZyAoYC1lYCwgYC1mYCwgYC1FYCwgYC11YCwgYC16YCwgXHUyMDI2KSBjaGFuZ2VzXG4gKiBzY3JpcHQgc2VtYW50aWNzIG9yIHJlY29yZCBzZXBhcmF0aW9uIGFuZCBmYWlscyBjbG9zZWQuIGAxLDIhZGAgaXNcbiAqIGRlbGliZXJhdGVseSBOT1QgYWxsb3dsaXN0ZWQgXHUyMDE0IGEgcmFuZ2UtY29tcGxlbWVudCBkZWxldGUgaGFwcGVucyB0b1xuICogcHJlc2VydmUgcmVjb3JkcywgYnV0IHRoZSBhbGxvd2xpc3QgYWRtaXRzIG9ubHkgdGhlIHByb3ZhYmxlIG51bWVyaWNcbiAqIGZvcm1zLCBzbyBpdCBmYWlscyBjbG9zZWQgbGlrZSBldmVyeXRoaW5nIGVsc2UuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1TZWRTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBsZXQgc2NyaXB0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHN1cHByZXNzQXV0b1ByaW50ID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgYXJndi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBzdXBwcmVzc0F1dG9QcmludCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpICYmIGEgIT09ICctJykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChzY3JpcHQgIT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICBzY3JpcHQgPSBhO1xuICB9XG4gIHJldHVybiBzY3JpcHQgIT09IG51bGwgJiYgaXNWZXJiYXRpbVNlZFNjcmlwdChzY3JpcHQsIHN1cHByZXNzQXV0b1ByaW50KTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgcG9zdC1nYXRlZCBgYXdrYCBzdGFnZSdzIHByb2dyYW0gcHJvdmFibHkgc2VsZWN0cyB3aG9sZSByZWNvcmRzXG4gKiB3aXRoIHRoZSBkZWZhdWx0IHByaW50IGFjdGlvbiwgc28gdGhlIG91dHB1dCBieXRlcyBhcmUgdmVyYmF0aW0uIFRoZVxuICogcHJvZ3JhbSBtdXN0IGJlIHRoZSBzb2xlIHBvc2l0aW9uYWwgKG5vIGAtRmAvYC12YC9gLWZgIGZsYWdzLCBubyBmaWxlXG4gKiBhcmdzKSBhbmQgbWF0Y2ggYSBjb25kaXRpb24tb25seSBmb3JtOiBgTlIgT1AgTmAgd2l0aCBPUCBpblxuICoge2A8YCwgYDw9YCwgYD5gLCBgPj1gLCBgPT1gLCBgIT1gfSBhZ2FpbnN0IGRlY2ltYWwgZGlnaXRzIChyZWNvcmQtbnVtYmVyXG4gKiB3aW5kb3dzKSwgb3IgYE5SICUgTiA9PSBNYCAvIGBOUiAlIE4gIT0gTWAgKHBhcml0eSBzdWJzZXRzKS4gTk8gYnJhY2VzLFxuICogTk8gYWN0aW9ucywgTk8gZmllbGQvcmVjb3JkIHJlZmVyZW5jZXMgKGAkYCksIE5PIGBwcmludGAsIE5PIGBzdWJgL1xuICogYGdzdWJgIFx1MjAxNCBhbnkgb2YgdGhvc2UgcmV3cml0ZXMgb3IgcmVudW1iZXJzIGFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1Bd2tTdGFnZShhcmd2OiBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAoYXJndi5sZW5ndGggIT09IDIpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcHJvZ3JhbSA9IGFyZ3ZbMV07XG4gIHJldHVybiAvXk5SXFxzKig8PXw+PXw9PXwhPXw8fD4pXFxzKlxcZCskLy50ZXN0KHByb2dyYW0pIHx8IC9eTlJcXHMqJVxccypcXGQrXFxzKig9PXwhPSlcXHMqXFxkKyQvLnRlc3QocHJvZ3JhbSk7XG59XG5cbi8qKlxuICogVGhlIHNjcmlwdCBvZiBhIHBvc3QtZ2F0ZWQgYHBlcmxgIHN0YWdlJ3MgYXJndiB3aGVuIGl0cyBmb3JtIGlzIGV4YWN0bHlcbiAqIGBwZXJsIC1uZSA8c2NyaXB0PmAgb3IgYHBlcmwgLW4gLWUgPHNjcmlwdD5gIFx1MjAxNCBub3RoaW5nIGVsc2UuIEFueSBvdGhlclxuICogZmxhZyAoYC1wYCwgYC1hYCwgYC1GYCwgXHUyMDI2KSBvciBhbnkgcG9zaXRpb25hbCBiZXlvbmQgdGhlIHNjcmlwdCAoZmlsZSBhcmdzXG4gKiBcdTIwMTQgdGhlIHN0YWdlIHRoZW4gcmVhZHMgZmlsZXMsIG5vdCB0aGUgcGlwZSkgcmV0dXJucyBudWxsIGFuZCBmYWlsc1xuICogY2xvc2VkLlxuICovXG5mdW5jdGlvbiB2ZXJiYXRpbVBlcmxTY3JpcHQoYXJndjogc3RyaW5nW10pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGFyZ3YubGVuZ3RoID09PSAzICYmIGFyZ3ZbMV0gPT09ICctbmUnKSByZXR1cm4gYXJndlsyXTtcbiAgaWYgKGFyZ3YubGVuZ3RoID09PSA0ICYmIGFyZ3ZbMV0gPT09ICctbicgJiYgYXJndlsyXSA9PT0gJy1lJykgcmV0dXJuIGFyZ3ZbM107XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBwb3N0LWdhdGVkIGBwZXJsYCBzdGFnZSBwcm92YWJseSBwcmludHMgd2hvbGUgaW5wdXQgcmVjb3Jkc1xuICogYnl0ZS12ZXJiYXRpbSAoc3RyZWFtLXBvc2l0aW9uIHNlbGVjdGlvbiBvbmx5KS4gYC1uYCB3cmFwcyB0aGUgc2NyaXB0IGluXG4gKiBhIGxpbmUgbG9vcCB3aXRob3V0IGF1dG8tcHJpbnRpbmcsIGFuZCB0aGUgc2NyaXB0IG11c3QgYmUgYSBiYXJlIGBwcmludGBcbiAqIGd1YXJkZWQgYnkgYSBzdHJlYW0tcG9zaXRpb24gY29uZGl0aW9uIChgcHJpbnQgaWYgJC4gPD0gMmAsIGBwcmludCB1bmxlc3NcbiAqICQuID4gMmAsIGBwcmludCBpZiAkLiA9PSAyYCkgXHUyMDE0IGJhcmUgYHByaW50YCBlbWl0cyBgJF9gIHZlcmJhdGltIGluY2x1ZGluZ1xuICogaXRzIHRyYWlsaW5nIG5ld2xpbmUsIHNvIHJlY29yZHMgc3RheSBjb21wbGV0ZSBmb3IgdGhlIHRlcm1pbmF0aW5nLW5ld2xpbmVcbiAqIHJ1bGUgYW5kIHRoZWlyIHBvc2l0aW9ucyBhcmUgZXhhY3RseSB0aGUgZWFybGllciBzdGFnZSdzIGZpbGUgbGluZXMuXG4gKiBBbnl0aGluZyBlbHNlIFx1MjAxNCBpbmNsdWRpbmcgYHByaW50IFwiJC46JF9cImAgKHJlbnVtYmVycyksIGAtcGAsIGFueSBvdGhlclxuICogZXhwcmVzc2lvbiwgYW55IGZpbGUgYXJncyBcdTIwMTQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBpc1ZlcmJhdGltUGVybFN0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNjcmlwdCA9IHZlcmJhdGltUGVybFNjcmlwdChhcmd2KTtcbiAgaWYgKHNjcmlwdCA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gL15cXHMqcHJpbnRcXHMrKD86aWZ8dW5sZXNzKVxccytcXCRcXC5cXHMqKDw9fD49fD09fCE9fDx8PilcXHMqXFxkK1xccyo7P1xccyokLy50ZXN0KHNjcmlwdCk7XG59XG5cbi8qKlxuICogV2hldGhlciBhIHBvc3QtZ2F0ZWQgYHRyYCBzdGFnZSBwcm92YWJseSBkZWxldGVzIGEgY2hhcmFjdGVyIHNldCB0aGF0XG4gKiBsZWF2ZXMgdGhlIGVhcmxpZXIgcmVjb3Jkcycgc2hhcGUgYW5kIGxpbmUgbnVtYmVycyB1bnRvdWNoZWQuIE9ubHkgdGhlXG4gKiBleGFjdCBgdHIgLWQgPHNldD5gIGZvcm0gcXVhbGlmaWVzIChvbmUgc2V0IHRva2VuLCBubyBvdGhlciBmbGFncywgbm9cbiAqIGZpbGUgYXJncyk7IHRoZSBzZXQgbXVzdCBjb250YWluIE5PTkUgb2YgYDAtOWAgKGRlbGV0aW5nIGRpZ2l0c1xuICogcmVudW1iZXJzKSwgYDpgIChkZWxldGluZyBjb2xvbnMgZGVzdHJveXMgdGhlIHJlY29yZCBzaGFwZSBcdTIwMTQgdGhpcyBhbHNvXG4gKiBibG9ja3MgYFs6XHUyMDI2Ol1gIGNsYXNzIHN5bnRheCksIG9yIHRoZSBgXFxuYCBlc2NhcGUgKGRlbGV0aW5nIG5ld2xpbmVzXG4gKiBtZXJnZXMgcmVjb3JkcykuIEFsbG93ZWQ6IGB0ciAtZCAnXFxyJ2AgKHRoZSBDUkxGIGlkaW9tKSwgYHRyIC1kICcgJ2AsXG4gKiBgdHIgLWQgJ1xcdFxccidgLCBgdHIgLWQgJ2EteidgLiBBbnkgc3Vic3RpdHV0aW9uIGZvcm0gKGB0ciAnMScgJzknYCBcdTIwMTRcbiAqIHJld3JpdGVzIGRpZ2l0cyBpbnNpZGUgbGluZSBudW1iZXJzKSwgYC1zYC9gLWNgLCBvciBhbnl0aGluZyBlbHNlIGZhaWxzXG4gKiBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIGlzVmVyYmF0aW1UclN0YWdlKGFyZ3Y6IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChhcmd2Lmxlbmd0aCAhPT0gMyB8fCBhcmd2WzFdICE9PSAnLWQnKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHNldCA9IGFyZ3ZbMl07XG4gIHJldHVybiAhL1swLTk6XS8udGVzdChzZXQpICYmICFzZXQuaW5jbHVkZXMoJ1xcXFxuJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGF5b3V0IGRldGVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGxpbmVzIG9mIGBzdGRvdXRgIHdob3NlIHRlcm1pbmF0aW5nIG5ld2xpbmUgaXMgcHJlc2VudCBpbiB0aGUgcmVzcG9uc2VcbiAqIHRleHQuIFRoZSBmaW5hbCBzcGxpdCBlbGVtZW50IGlzIGVpdGhlciB0aGUgZW1wdHkgc3RyaW5nIGxlZnQgYnkgYSB0cmFpbGluZ1xuICogbmV3bGluZSBvciBhbiB1bnRlcm1pbmF0ZWQgcGFydGlhbCByZWNvcmQgXHUyMDE0IGVpdGhlciB3YXkgaXQgaXMgbm90IGEgcmVjb3JkLFxuICogc28gaXQgaXMgYWx3YXlzIGRyb3BwZWQgKHRoZSB1bml2ZXJzYWwgdHJ1bmNhdGlvbiBydWxlKS5cbiAqL1xuZnVuY3Rpb24gY29tcGxldGVMaW5lcyhzdGRvdXQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXMgPSBzdGRvdXQuc3BsaXQoJ1xcbicpO1xuICBsaW5lcy5wb3AoKTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgZXZlcnkgbm9uLWVtcHR5IHJlY29yZCBvZiBhIGBsaW5lOnRleHRgIHJlc3BvbnNlIHBhcnNlcyBhc1xuICogbnVtYmVyZWQgXHUyMDE0IHRoZSBjcm9zcy1yZWNvcmQgY29uc2lzdGVuY3kgY2hlY2sgdGhhdCBrZWVwcyBvbmUtZmlsZVxuICogYXR0cmlidXRpb24gZnJvbSByZXN0aW5nIG9uIGEgc2luZ2xlIHJlY29yZCdzIHNoYXBlLiBBIGJhcmUgYC0tYCBsaW5lIGlzXG4gKiB0aGUgZ3JvdXAgc2VwYXJhdG9yIGEgY29udGV4dCBydW4gKGAtQWAvYC1CYC9gLUNgKSBlbWl0cyBiZXR3ZWVuXG4gKiBub24tYWRqYWNlbnQgd2luZG93czogaXQgaXMgbm90IGEgcmVjb3JkIGFuZCBjYW4gbmV2ZXIgYmVjb21lIGEgdG91Y2gsIHNvXG4gKiB0b2xlcmF0aW5nIGl0IGNhbm5vdCBmYWJyaWNhdGUgXHUyMDE0IHdoaWxlIHJlamVjdGluZyBpdCBzZW5kcyB0aGUgd2hvbGVcbiAqIHJlc3BvbnNlIHRvIGxheW91dCBudWxsICh6ZXJvIHNwYW5zKSBhbmQsIHdvcnNlLCBsZXRzIGEgdHJ1bmNhdGVkIHByZWZpeFxuICogZGVjb2RlIHJlY29yZHMgdGhlIGNvbXBsZXRlIG91dHB1dCByZWZ1c2VzIChjdXR0aW5nIG11c3QgbmV2ZXIgYWRkKS5cbiAqL1xuZnVuY3Rpb24gcmVjb3Jkc0FyZU9uZUZpbGUoc3Rkb3V0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3QgbGluZXMgPSBjb21wbGV0ZUxpbmVzKHN0ZG91dCk7XG4gIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIGxpbmVzLmV2ZXJ5KChsaW5lKSA9PiBsaW5lID09PSAnJyB8fCBsaW5lID09PSAnLS0nIHx8IHBhcnNlT25lRmlsZVJlY29yZChsaW5lKSAhPT0gbnVsbCk7XG59XG5cbi8qKlxuICogRGVjaWRlIHdoaWNoIHNlYXJjaCBsYXlvdXQgYSByZXNwb25zZSB1c2VzIGZyb20gdGhlIHNoYXBlIG9mIGl0cyBmaXJzdFxuICogcmVjb3JkLCBjb25zdWx0aW5nIHRoZSBjb21tYW5kJ3MgY29udGV4dCBmbGFncyB0byBicmVhayB0aGUgcmVjdXJzaXZlIC9cbiAqIGNvbnRleHQgYW1iaWd1aXR5IChib3RoIGVtaXQgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzKS4gRmFpbCBjbG9zZWQ6XG4gKiBhbiB1bnJlY29nbml6ZWQgZmlyc3QgcmVjb3JkIG1lYW5zIG5vdGhpbmcgaW4gdGhpcyByZXNwb25zZSBpcyB0cnVzdGVkLlxuICpcbiAqIFRoZSBgbGluZTp0ZXh0YC1vbmx5IGxheW91dHMgKG9uZS1maWxlLCBoZWFkaW5nKSByZXF1aXJlIGNvbW1hbmQtc2lkZVxuICogbnVtYmVyZWQgZXZpZGVuY2U6IHJnIGFuZCBncmVwIGRlZmF1bHQgdG8gTk8gbGluZSBudW1iZXJzIHdoZW4gcGlwZWQsIHNvIGFcbiAqIGRpZ2l0cy1sZWFkaW5nIHJlY29yZCB3aXRob3V0IGAtbmAvYC0tbGluZS1udW1iZXJgIGlzIGNvbnRlbnQsIG5vdCBhXG4gKiBwb3NpdGlvbiBcdTIwMTQgYGdyZXAgVE9ETyBub3Rlcy5tZGAgd2hvc2UgbWF0Y2hpbmcgbGluZSBpcyBgMTIzOiBUT0RPIGl0ZW1gXG4gKiBtdXN0IG5vdCB0b3VjaCBsaW5lIDEyMywgYW5kIGByZyAtbCBhbHBoYSAyMDI0LWxvZy50eHRgIG11c3Qgbm90IHRvdWNoXG4gKiBsaW5lIDIwMjQuIFRoZSBvbmUtZmlsZSBsYXlvdXQgYWRkaXRpb25hbGx5IHJlcXVpcmVzIGV4YWN0bHkgb25lIGV4cGxpY2l0XG4gKiBmaWxlIGFyZ3VtZW50IHRoYXQgaXMgYSByZWFsIGZpbGUgKGEgZGlyZWN0b3J5IG9yIG5vIGFyZ3MgbWVhbnMgcmVjb3Jkc1xuICogY2FycnkgcGF0aCBwcmVmaXhlcyBcdTIwMTQgYSBwdXJlLWRpZ2l0cyBmaWxlbmFtZSBlbWl0dGVkIGZpcnN0IG11c3QgZmFsbFxuICogdGhyb3VnaCB0byByZWN1cnNpdmUpLCBubyBgLUhgL2AtLXdpdGgtZmlsZW5hbWVgICh3aGljaCBmb3JjZXMgcGF0aFxuICogcHJlZml4ZXMpLCBhbmQgY3Jvc3MtcmVjb3JkIGNvbnNpc3RlbmN5IHZpYSBgcmVjb3Jkc0FyZU9uZUZpbGVgLlxuICovXG5mdW5jdGlvbiBkZXRlY3RMYXlvdXQoc3Rkb3V0OiBzdHJpbmcsIGluZm86IFNlYXJjaEFyZ3ZJbmZvLCBvbmVGaWxlRWxpZ2libGU6IGJvb2xlYW4pOiBTZWFyY2hMYXlvdXQgfCBudWxsIHtcbiAgaWYgKHN0ZG91dC5pbmNsdWRlcygnXFwwJykpIHJldHVybiAnbnVsbC1zZXBhcmF0ZWQnO1xuICBjb25zdCBsaW5lcyA9IGNvbXBsZXRlTGluZXMoc3Rkb3V0KTtcbiAgY29uc3QgZmlyc3QgPSBsaW5lcy5maW5kKChsaW5lKSA9PiBsaW5lICE9PSAnJyk7XG4gIGlmIChmaXJzdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eXFxkK1stOl0vLnRlc3QoZmlyc3QpKSB7XG4gICAgaWYgKG9uZUZpbGVFbGlnaWJsZSAmJiByZWNvcmRzQXJlT25lRmlsZShzdGRvdXQpKSByZXR1cm4gJ29uZS1maWxlJztcbiAgICAvLyBOb3QgdGhlIG9uZS1maWxlIGxheW91dDogZmFsbCB0aHJvdWdoIFx1MjAxNCBhIGRpZ2l0cy1sZWFkaW5nIHJlY29yZCBpc1xuICAgIC8vIG1vcmUgcGxhdXNpYmx5IHRoZSBgcGF0aDpsaW5lOnRleHRgIHJlY29yZCBvZiBhIGRpZ2l0cy1uYW1lZCBmaWxlLFxuICAgIC8vIHdoaWNoIHRoZSByZWN1cnNpdmUgY2hlY2tzIGJlbG93IHBpY2sgdXAuXG4gIH1cbiAgaWYgKC9eW146XSs6XFxkKy8udGVzdChmaXJzdCkpIHJldHVybiBpbmZvLmNvbnRleHRGbGFncyA/ICdjb250ZXh0JyA6ICdyZWN1cnNpdmUnO1xuICAvLyBBIGNvbnRleHQgd2luZG93IGNhbiBvcGVuIHdpdGggYSBjb250ZXh0IHJlY29yZCAoaXRzIC1CIHNpZGUpLCB3aG9zZVxuICAvLyBgcGF0aC1saW5lLXRleHRgIHNoYXBlIGlzIGFtYmlndW91cyB3aGVuIHRoZSBwYXRoIGl0c2VsZiBjb250YWlucyBhXG4gIC8vIGRhc2ggXHUyMDE0IGBzcmMvbXktZmlsZS50cy0yLW9uZWAgc3BsaXRzIGluc2lkZSB0aGUgcGF0aC4gRXZlcnkgY29udGV4dFxuICAvLyBncm91cCBpcyBhbmNob3JlZCB0byBhIGBwYXRoOmxpbmU6dGV4dGAgbWF0Y2ggcmVjb3JkIHdob3NlIGNvbG9uIHNwbGl0XG4gIC8vIGlzIHVuYW1iaWd1b3VzLCBzbyB0aGUgcmVzcG9uc2UncyBvd24gbWF0Y2ggcmVjb3JkcyBkZXRlY3QgdGhlIGxheW91dC5cbiAgaWYgKGluZm8uY29udGV4dEZsYWdzICYmIGxpbmVzLnNvbWUoKGxpbmUpID0+IGxpbmUgIT09ICcnICYmIC9eW146XSs6XFxkKy8udGVzdChsaW5lKSkpIHJldHVybiAnY29udGV4dCc7XG4gIGlmICgvXlteLTpdKy1cXGQrLS8udGVzdChmaXJzdCkpIHJldHVybiBpbmZvLmNvbnRleHRGbGFncyA/ICdjb250ZXh0JyA6IG51bGw7XG4gIGlmIChpbmZvLm51bWJlcmVkICYmIC9eW146XSskLy50ZXN0KGZpcnN0KSkgcmV0dXJuICdoZWFkaW5nJztcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVjb3JkIHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IGEgcmVjb3JkIG9uIGl0cyBmaXJzdCB0d28gb2NjdXJyZW5jZXMgb2YgYHNlcGAgKHRoZSBsYXlvdXQnc1xuICogcGF0aC9saW5lL3RleHQgc2VwYXJhdG9ycyksIHNvIHNlcGFyYXRvcnMgaW5zaWRlIHRoZSB0ZXh0IGFyZSBzYWZlLiBBIHBhdGhcbiAqIGNvbnRhaW5pbmcgYSBjb2xvbiwgYSBub24tbnVtZXJpYyBsaW5lIHRva2VuLCBvciBhbiBlbXB0eSBwYXRoIGlzXG4gKiBwYXRoLWFtYmlndW91cyBhbmQgZHJvcHBlZC5cbiAqL1xuZnVuY3Rpb24gcGFyc2VSZWNvcmQobGluZTogc3RyaW5nLCBzZXA6IHN0cmluZyk6IHsgcGF0aDogc3RyaW5nOyBsaW5lOiBudW1iZXI7IHRleHQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IGZpcnN0ID0gbGluZS5pbmRleE9mKHNlcCk7XG4gIGlmIChmaXJzdCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBjb25zdCBzZWNvbmQgPSBsaW5lLmluZGV4T2Yoc2VwLCBmaXJzdCArIDEpO1xuICBpZiAoc2Vjb25kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHBhdGggPSBsaW5lLnNsaWNlKDAsIGZpcnN0KTtcbiAgY29uc3QgbGluZVRva2VuID0gbGluZS5zbGljZShmaXJzdCArIDEsIHNlY29uZCk7XG4gIGNvbnN0IHRleHQgPSBsaW5lLnNsaWNlKHNlY29uZCArIDEpO1xuICBpZiAocGF0aCA9PT0gJycgfHwgcGF0aC5pbmNsdWRlcygnOicpKSByZXR1cm4gbnVsbDtcbiAgaWYgKCEvXlxcZCskLy50ZXN0KGxpbmVUb2tlbikpIHJldHVybiBudWxsO1xuICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyLnBhcnNlSW50KGxpbmVUb2tlbiwgMTApO1xuICBpZiAobGluZU51bWJlciA8PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcGF0aCwgbGluZTogbGluZU51bWJlciwgdGV4dCB9O1xufVxuXG4vKiogT25lIG51bWJlcmVkIHJlY29yZCBpbiB0aGUgb25lLWZpbGUvaGVhZGluZyBgbGluZTp0ZXh0YCBvciBgbGluZS10ZXh0YCBzdHlsZS4gKi9cbmZ1bmN0aW9uIHBhcnNlT25lRmlsZVJlY29yZChsaW5lOiBzdHJpbmcpOiB7IGxpbmU6IG51bWJlcjsgdGV4dDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgbSA9IC9eKFxcZCspKFs6LV0pLy5leGVjKGxpbmUpO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGxpbmVOdW1iZXIgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICBpZiAobGluZU51bWJlciA8PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgbGluZTogbGluZU51bWJlciwgdGV4dDogbGluZS5zbGljZShtWzBdLmxlbmd0aCkgfTtcbn1cblxuLyoqXG4gKiBEZWNvZGUgYSBjb250ZXh0IHJlY29yZCAoYHBhdGgtbGluZS10ZXh0YCkgYnkgYW5jaG9yaW5nIGl0IHRvIHRoZSBleGFjdFxuICogcGF0aHMgdGhlIHJlc3BvbnNlJ3MgYHBhdGg6bGluZTp0ZXh0YCBtYXRjaCByZWNvcmRzIGVzdGFibGlzaGVkOiB0aGVcbiAqIHJlY29yZCBtdXN0IHN0YXJ0IHdpdGggYSBrbm93biBwYXRoIGZvbGxvd2VkIGJ5IGAtbGluZS10ZXh0YC4gTG9uZ2VzdCBwYXRoXG4gKiBmaXJzdCwgc28gYSBwYXRoIHRoYXQgaXMgYSBwcmVmaXggb2YgYW5vdGhlciAoYGEtYi50c2AgdnMgYGEtYi1jLnRzYClcbiAqIGNhbid0IHNoYWRvdyBpdC4gQSBkYXNoIGluc2lkZSBhIHBhdGggbWFrZXMgdGhlIHBsYWluIGRhc2ggc3BsaXRcbiAqIGFtYmlndW91cyAoYHNyYy9teS1maWxlLnRzLTQtY3R4YCBzcGxpdHMgaW5zaWRlIHRoZSBwYXRoIGFuZCBpdHMgbGluZVxuICogdG9rZW4gY29tZXMgb3V0IG5vbi1udW1lcmljKSwgd2hpY2ggaXMgd2h5IHRoZSBrbm93bi1wYXRoIGFuY2hvciBleGlzdHMuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlQ29udGV4dFJlY29yZChsaW5lOiBzdHJpbmcsIGtub3duUGF0aHM6IHN0cmluZ1tdKTogeyBwYXRoOiBzdHJpbmc7IGxpbmU6IG51bWJlcjsgdGV4dDogc3RyaW5nIH0gfCBudWxsIHtcbiAgZm9yIChjb25zdCBwYXRoIG9mIGtub3duUGF0aHMpIHtcbiAgICBpZiAoIWxpbmUuc3RhcnRzV2l0aChgJHtwYXRofS1gKSkgY29udGludWU7XG4gICAgY29uc3QgdGFpbCA9IGxpbmUuc2xpY2UocGF0aC5sZW5ndGggKyAxKTtcbiAgICBjb25zdCBtID0gL14oXFxkKyktLy5leGVjKHRhaWwpO1xuICAgIGlmIChtID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBsaW5lTnVtYmVyID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBpZiAobGluZU51bWJlciA8PSAwKSBjb250aW51ZTtcbiAgICByZXR1cm4geyBwYXRoLCBsaW5lOiBsaW5lTnVtYmVyLCB0ZXh0OiB0YWlsLnNsaWNlKG1bMF0ubGVuZ3RoKSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogMS1iYXNlZCBsaW5lIGNvdW50IG9mIHJlc3BvbnNlIHRleHQgdGhhdCBob2xkcyBhbiBlbnRpcmUgZmlsZSdzIGNvbnRlbnQuICovXG5mdW5jdGlvbiBsaW5lQ291bnQodGV4dDogc3RyaW5nKTogbnVtYmVyIHtcbiAgaWYgKHRleHQgPT09ICcnKSByZXR1cm4gMDtcbiAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IHRleHQuZW5kc1dpdGgoJ1xcbicpID8gdGV4dC5zbGljZSgwLCAtMSkgOiB0ZXh0O1xuICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExheW91dCBkZWNvZGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRGVjb2RlIGBzdGRvdXRgIGludG8gc2VhcmNoIHJlY29yZHMgZm9yIGBsYXlvdXRgLiBPbmUtZmlsZSByZWNvcmRzIGFyZVxuICogYXR0cmlidXRlZCB0byBgc2luZ2xlRmlsZUFyZ2AgKHRoZSBjb21tYW5kJ3Mgc29sZSBleHBsaWNpdCBmaWxlKTsgZm9yIGFueVxuICogb3RoZXIgbGF5b3V0IHRoZSByZWNvcmQgcGF0aHMgYXJlIHRoZSByZXNwb25zZSdzIG93bi4gTnVsbC1zZXBhcmF0ZWRcbiAqIHJlY29yZHMgY2FycnkgYGxpbmU6IG51bGxgIGFuZCB0aGUgZnVsbCBmaWxlIGNvbnRlbnQgaW4gYHRleHRgLCBiZWNhdXNlIHRoZVxuICogb25seSB3ZWxsLWRlZmluZWQgdG91Y2ggZm9yIGEgYHBhdGg6MTpcdTIwMjZgIHJlY29yZCBob2xkaW5nIGFuIGVudGlyZSBmaWxlIGlzXG4gKiB0aGUgd2hvbGUgZmlsZS5cbiAqL1xuZnVuY3Rpb24gZGVjb2RlU2VhcmNoTGF5b3V0KGxheW91dDogU2VhcmNoTGF5b3V0LCBzdGRvdXQ6IHN0cmluZywgc2luZ2xlRmlsZUFyZzogc3RyaW5nIHwgbnVsbCk6IFNlYXJjaFJlY29yZFtdIHtcbiAgY29uc3QgcmVjb3JkczogU2VhcmNoUmVjb3JkW10gPSBbXTtcbiAgc3dpdGNoIChsYXlvdXQpIHtcbiAgICBjYXNlICdyZWN1cnNpdmUnOlxuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICBjb25zdCByZWMgPSBwYXJzZVJlY29yZChsaW5lLCAnOicpO1xuICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2gocmVjKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NvbnRleHQnOiB7XG4gICAgICAvLyBNYXRjaCByZWNvcmRzIGFyZSBgcGF0aDpsaW5lOnRleHRgOyBjb250ZXh0IHJlY29yZHMgYXJlXG4gICAgICAvLyBgcGF0aC1saW5lLXRleHRgICh0aGUgc2VwYXJhdG9yIGlzIGEgZGFzaCB3aGVyZXZlciBhIG1hdGNoIHJlY29yZFxuICAgICAgLy8gd291bGQgdXNlIGEgY29sb24pLiBCb3RoIGNhcnJ5IHRoZSByZWFsIGxpbmUgbnVtYmVyOyBgLS1gIGdyb3VwXG4gICAgICAvLyBzZXBhcmF0b3JzIGFyZSBub3QgcmVjb3Jkcy4gQSBkYXNoIGluc2lkZSBhIHBhdGggYnJlYWtzIHRoZSBkYXNoXG4gICAgICAvLyBzcGxpdCwgc28gdGhlIHJlc3BvbnNlJ3MgbWF0Y2ggcmVjb3JkcyBmaXJzdCBlc3RhYmxpc2ggdGhlIGZpbGVzJ1xuICAgICAgLy8gZXhhY3QgcGF0aHMgYW5kIGVhY2ggY29udGV4dCByZWNvcmQgaXMgYW5jaG9yZWQgdG8gYSBrbm93biBwYXRoXG4gICAgICAvLyBwcmVmaXggYmVmb3JlIGl0cyBgLWxpbmUtdGV4dGAgdGFpbCwgd2l0aCB0aGUgZGFzaC1mcmVlIGRlZmF1bHQgYXNcbiAgICAgIC8vIHRoZSBmYWxsYmFjay4gQ29udGV4dCByZWNvcmRzIGNhbiBwcmVjZWRlIHRoZWlyIG1hdGNoICgtQiB3aW5kb3dzKSxcbiAgICAgIC8vIHNvIHRoZSBrbm93biBzZXQgaXMgYnVpbHQgaW4gYSBmaXJzdCBwYXNzIG92ZXIgYWxsIGxpbmVzLlxuICAgICAgY29uc3QgbGluZXMgPSBjb21wbGV0ZUxpbmVzKHN0ZG91dCk7XG4gICAgICBjb25zdCBrbm93biA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgIGlmIChsaW5lID09PSAnLS0nKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQobGluZSwgJzonKTtcbiAgICAgICAgaWYgKHJlYyAhPT0gbnVsbCkga25vd24uYWRkKHJlYy5wYXRoKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGtub3duU29ydGVkID0gWy4uLmtub3duXS5zb3J0KChhLCBiKSA9PiBiLmxlbmd0aCAtIGEubGVuZ3RoKTtcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICBpZiAobGluZSA9PT0gJy0tJykgY29udGludWU7XG4gICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlUmVjb3JkKGxpbmUsICc6JykgPz8gcGFyc2VDb250ZXh0UmVjb3JkKGxpbmUsIGtub3duU29ydGVkKSA/PyBwYXJzZVJlY29yZChsaW5lLCAnLScpO1xuICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2gocmVjKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICdoZWFkaW5nJzpcbiAgICAgIC8vIEEgZmlsZSBoZWFkZXIgbGluZSwgdGhlbiBgbGluZTp0ZXh0YCByZWNvcmRzOyBibGFuayBsaW5lcyBzZXBhcmF0ZVxuICAgICAgLy8gZmlsZSBzZWN0aW9uczsgYW55IG5vbi1yZWNvcmQgbGluZSBzdGFydHMgdGhlIG5leHQgZmlsZSdzIHNlY3Rpb24uXG4gICAgICB7XG4gICAgICAgIGxldCBjdXJyZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICAgIGlmIChsaW5lID09PSAnJykgY29udGludWU7XG4gICAgICAgICAgY29uc3QgcmVjID0gcGFyc2VPbmVGaWxlUmVjb3JkKGxpbmUpO1xuICAgICAgICAgIGlmIChyZWMgPT09IG51bGwpIHtcbiAgICAgICAgICAgIGN1cnJlbnQgPSBsaW5lO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgcmVjb3Jkcy5wdXNoKHsgcGF0aDogY3VycmVudCwgbGluZTogcmVjLmxpbmUsIHRleHQ6IHJlYy50ZXh0IH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnb25lLWZpbGUnOlxuICAgICAgaWYgKHNpbmdsZUZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGNvbXBsZXRlTGluZXMoc3Rkb3V0KSkge1xuICAgICAgICAgIGNvbnN0IHJlYyA9IHBhcnNlT25lRmlsZVJlY29yZChsaW5lKTtcbiAgICAgICAgICBpZiAocmVjICE9PSBudWxsKSByZWNvcmRzLnB1c2goeyBwYXRoOiBzaW5nbGVGaWxlQXJnLCBsaW5lOiByZWMubGluZSwgdGV4dDogcmVjLnRleHQgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ251bGwtc2VwYXJhdGVkJzpcbiAgICAgIC8vIGBncmVwIC16YDogZWFjaCBtYXRjaGluZyBmaWxlIGFycml2ZXMgYXMgb25lIE5VTC10ZXJtaW5hdGVkXG4gICAgICAvLyBgcGF0aDoxOjxlbnRpcmUgZmlsZSBjb250ZW50PmAgcmVjb3JkLiBUaGUgcmVjb3JkIGlzIGZ1bGx5IG9ic2VydmVkXG4gICAgICAvLyBvbmx5IHdoZW4gaXRzIHRlcm1pbmF0aW5nIE5VTCBpcyBwcmVzZW50LlxuICAgICAge1xuICAgICAgICBjb25zdCBwYXJ0cyA9IHN0ZG91dC5zcGxpdCgnXFwwJyk7XG4gICAgICAgIGlmICghc3Rkb3V0LmVuZHNXaXRoKCdcXDAnKSkgcGFydHMucG9wKCk7XG4gICAgICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICAgIGlmIChwYXJ0ID09PSAnJykgY29udGludWU7XG4gICAgICAgICAgY29uc3QgcmVjID0gcGFyc2VSZWNvcmQocGFydCwgJzonKTtcbiAgICAgICAgICBpZiAocmVjID09PSBudWxsIHx8IHJlYy5saW5lICE9PSAxKSBjb250aW51ZTtcbiAgICAgICAgICByZWNvcmRzLnB1c2goeyBwYXRoOiByZWMucGF0aCwgbGluZTogbnVsbCwgdGV4dDogcmVjLnRleHQgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICB9XG4gIHJldHVybiByZWNvcmRzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNjb3BlIHJlc3RyaWN0aW9uIGFuZCBjb2FsZXNjaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoZXRoZXIgYGFic2AgcmVzb2x2ZXMgaW5zaWRlIG9uZSBvZiB0aGUgcGVybWl0dGVkIHJvb3RzIChwYXRoLXByZWZpeCBjb250YWlubWVudCkuICovXG5mdW5jdGlvbiBpbnNpZGVSb290KGFiczogc3RyaW5nLCByb290czogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCByb290IG9mIHJvb3RzKSB7XG4gICAgaWYgKGFicyA9PT0gcm9vdCB8fCBhYnMuc3RhcnRzV2l0aChyb290ICsgc2VwKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogV2hldGhlciBgYWJzYCBpcyBhbiBleGlzdGluZyByZWd1bGFyIGZpbGUgKGZvbGxvd2luZyBzeW1saW5rcykuICovXG5mdW5jdGlvbiBpc0ZpbGUoYWJzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gc3RhdFN5bmMoYWJzKS5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCB3b3JrdHJlZSByb290IGNvbnRhaW5pbmcgYHN0YXJ0RGlyYCwgZm91bmQgYnkgd2Fsa2luZyB1cCBmb3IgdGhlXG4gKiBmaXJzdCBkaXJlY3RvcnkgaG9sZGluZyBhIGAuZ2l0YCBlbnRyeSBcdTIwMTQgYSBkaXJlY3RvcnkgaW4gYSByZWd1bGFyIHJlcG8sIGFcbiAqIGBnaXRkaXI6YCBmaWxlIGluIGEgbGlua2VkIHdvcmt0cmVlIG9yIHN1Ym1vZHVsZS4gRGlmZi1mb3JtIG91dHB1dCBwYXRoc1xuICogYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSByZWdhcmRsZXNzIG9mIGN3ZCwgc28gZGlmZiBkZWNvZGUgcmVzb2x2ZXMgYWdhaW5zdFxuICogdGhpcyByb290IHJhdGhlciB0aGFuIHRoZSBlZmZlY3RpdmUgZGlyOyBzZWFyY2gtbGF5b3V0IHBhdGhzIGFyZVxuICogY3dkLXJlbGF0aXZlIGFuZCBzdGF5IGFuY2hvcmVkIHRvIHRoZSBlZmZlY3RpdmUgZGlyLiBObyBzdWJwcm9jZXNzIFx1MjAxNCB0aGVcbiAqIGNvbW1vbiBsYXllciBpbXBvcnRzIG9ubHkgbm9kZTogYnVpbHRpbnMuIE51bGwgd2hlbiBgc3RhcnREaXJgIGlzIG5vdFxuICogaW5zaWRlIGFueSB3b3JrdHJlZTsgZGlmZiBvdXRwdXQgaXMgdGhlbiBzdXNwZWN0IGFuZCB0aGUgcGFyc2UgZmFpbHNcbiAqIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gZmluZEdpdFJvb3Qoc3RhcnREaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBsZXQgZGlyID0gc3RhcnREaXI7XG4gIGZvciAoOzspIHtcbiAgICBpZiAoZXhpc3RzU3luYyhqb2luKGRpciwgJy5naXQnKSkpIHJldHVybiBkaXI7XG4gICAgY29uc3QgcGFyZW50ID0gZGlybmFtZShkaXIpO1xuICAgIGlmIChwYXJlbnQgPT09IGRpcikgcmV0dXJuIG51bGw7XG4gICAgZGlyID0gcGFyZW50O1xuICB9XG59XG5cbi8qKlxuICogT3JkZXIgc3BhbnMgZGV0ZXJtaW5pc3RpY2FsbHkgYW5kIGNhcCB0aGUgY291bnQgKGZhaWwtY2xvc2VkIGJleW9uZFxuICogYE1BWF9SRVNQT05TRV9TUEFOU2ApOiB0aGUgZmlyc3QgNTAgc3BhbnMgaW4gcGF0aCBvcmRlciBhcmUgZW1pdHRlZCwgdGhlXG4gKiByZXN0IGFyZSBkcm9wcGVkLiBOb3JtYWwgcGFyc2VzIGtlZXAgdGhlaXIgZW1pc3Npb24gb3JkZXIgXHUyMDE0IHRoZSBzb3J0IG9ubHlcbiAqIGVuZ2FnZXMgd2hlbiB0aGUgY2FwIGJpbmRzLlxuICovXG5mdW5jdGlvbiBjYXBTcGFucyhzcGFuczogUmVzcG9uc2VTcGFuW10pOiBSZXNwb25zZVNwYW5bXSB7XG4gIGlmIChzcGFucy5sZW5ndGggPD0gTUFYX1JFU1BPTlNFX1NQQU5TKSByZXR1cm4gc3BhbnM7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4uc3BhbnNdLnNvcnQoXG4gICAgKGEsIGIpID0+IGEuYWJzb2x1dGVQYXRoLmxvY2FsZUNvbXBhcmUoYi5hYnNvbHV0ZVBhdGgpIHx8IGEubGluZVN0YXJ0IC0gYi5saW5lU3RhcnQgfHwgYS5saW5lRW5kIC0gYi5saW5lRW5kXG4gICk7XG4gIHJldHVybiBvcmRlcmVkLnNsaWNlKDAsIE1BWF9SRVNQT05TRV9TUEFOUyk7XG59XG5cbi8qKlxuICogQ29hbGVzY2UgcGVyLWZpbGUgbGluZSBudW1iZXJzIGludG8gY29udGlndW91cyByYW5nZXM7IGFkamFjZW50IGFuZFxuICogb3ZlcmxhcHBpbmcgbGluZXMgbWVyZ2UsIGFuZCBkdXBsaWNhdGVzIG5ldmVyIGNyZWF0ZSBkdXBsaWNhdGUgc3VyZmFjZXMuXG4gKi9cbmZ1bmN0aW9uIGNvYWxlc2NlKGxpbmVzOiBudW1iZXJbXSk6IEFycmF5PFtudW1iZXIsIG51bWJlcl0+IHtcbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBzb3J0ZWQgPSBbLi4ubGluZXNdLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcbiAgY29uc3QgcmFuZ2VzOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiA9IFtdO1xuICBsZXQgc3RhcnQgPSBzb3J0ZWRbMF07XG4gIGxldCBlbmQgPSBzb3J0ZWRbMF07XG4gIGZvciAoY29uc3QgbiBvZiBzb3J0ZWQuc2xpY2UoMSkpIHtcbiAgICBpZiAobiA8PSBlbmQgKyAxKSB7XG4gICAgICBpZiAobiA+IGVuZCkgZW5kID0gbjtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2VzLnB1c2goW3N0YXJ0LCBlbmRdKTtcbiAgICAgIHN0YXJ0ID0gbjtcbiAgICAgIGVuZCA9IG47XG4gICAgfVxuICB9XG4gIHJhbmdlcy5wdXNoKFtzdGFydCwgZW5kXSk7XG4gIHJldHVybiByYW5nZXM7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBwZXItZmlsZSBsaW5lIHNldHMgaW50byBzcGFuczogcGF0aHMgcmVzb2x2ZSBhZ2FpbnN0IGBiYXNlRGlyYCxcbiAqIG11c3Qgc2l0IGluc2lkZSBvbmUgb2YgdGhlIHBlcm1pdHRlZCBgcm9vdHNgIChhIHRyYXZlcnNhbCBwYXRoIG5vcm1hbGl6ZXNcbiAqIG91dHNpZGUgdGhlbSBhbmQgaXMgcmVqZWN0ZWQpLCBhbmQgdGhlaXIgbGluZXMgY29hbGVzY2UgaW50byBjb250aWd1b3VzXG4gKiByYW5nZXMuXG4gKi9cbmZ1bmN0aW9uIHNwYW5zRm9yKHBlckZpbGU6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiwgYmFzZURpcjogc3RyaW5nLCByb290czogc3RyaW5nW10pOiBSZXNwb25zZVNwYW5bXSB7XG4gIGNvbnN0IHNwYW5zOiBSZXNwb25zZVNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBsaW5lc10gb2YgcGVyRmlsZSkge1xuICAgIGNvbnN0IGFicyA9IHJlc29sdmVQYXRoKGJhc2VEaXIsIHBhdGgpO1xuICAgIGlmICghaW5zaWRlUm9vdChhYnMsIHJvb3RzKSkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBbbGluZVN0YXJ0LCBsaW5lRW5kXSBvZiBjb2FsZXNjZShbLi4ubGluZXNdKSkge1xuICAgICAgc3BhbnMucHVzaCh7IGxpbmVTdGFydCwgbGluZUVuZCwgYWJzb2x1dGVQYXRoOiBhYnMgfSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBzcGFucztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBVbmlmaWVkLWRpZmYgZGVjb2RlciAoYGdpdCBkaWZmYCwgZGlmZi1mb3JtIGBnaXQgc2hvd2AsIGBnaXQgbG9nIC1wYClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEEgdW5pZmllZC1kaWZmIGh1bmsgaGVhZGVyOiBgQEAgLWFbLGJdICtjWyxkXSBAQGA7IG9taXR0ZWQgY291bnRzIG1lYW4gMS5cbiAqIEEgY3V0LW9mZiBoZWFkZXIgKG1pc3NpbmcgdGhlIGNsb3NpbmcgYEBAYCkgZG9lcyBub3QgbWF0Y2ggYW5kIGl0cyBodW5rIGlzXG4gKiBpZ25vcmVkLiBDb21iaW5lZC1kaWZmIGBAQEBgIGhlYWRlcnMgZG8gbm90IG1hdGNoICh0aGVpciByZWNvcmRzIGFyZVxuICogcmVqZWN0ZWQgYXQgdGhlIGBkaWZmIC0tY2NgIGxpbmUgYW55d2F5KS5cbiAqL1xuY29uc3QgSFVOS19IRUFERVIgPSAvXkBAIC0oXFxkKykoPzosKFxcZCspKT8gXFwrKFxcZCspKD86LChcXGQrKSk/IEBALztcblxuLyoqIFN0cmlwIHRoZSBgYS9gL2BiL2AgcHJlZml4IGEgdW5pZmllZC1kaWZmIHBhdGggY2Fycmllcy4gKi9cbmZ1bmN0aW9uIHN0cmlwRGlmZlByZWZpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCdhLycpIHx8IHAuc3RhcnRzV2l0aCgnYi8nKSA/IHAuc2xpY2UoMikgOiBwO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgYGRpZmYgLS1naXQgYS9vbGQgYi9uZXdgIGZpbGUgaGVhZGVyLCBgZGlmZiAtLWNjYC9gLS1jb21iaW5lZGBcbiAqIChhIHJlYWwgbWVyZ2UtY29uZmxpY3QgY29tYmluZWQgZGlmZjogbm8gcmFuZ2VzKSwgb3IgcmV0dXJuIG51bGwgZm9yXG4gKiBub24taGVhZGVyIGxpbmVzLiBBIGhlYWRlciB3aG9zZSBwYXRocyBhcmUgcXVvdGVkIGlzIHVucGFyc2VhYmxlIFx1MjAxNCB0aGVcbiAqIHBsYW4ncyBmYWlsLWNsb3NlZCBydWxlIGZvciBxdW90ZWQvdW5lc2NhcGFibGUgcGF0aHMuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlRGlmZkhlYWRlcihcbiAgbGluZTogc3RyaW5nXG4pOlxuICB8IHsga2luZDogJ2ZpbGUnOyBvbGRQYXRoOiBzdHJpbmcgfCBudWxsOyBuZXdQYXRoOiBzdHJpbmcgfCBudWxsIH1cbiAgfCB7IGtpbmQ6ICdjb21iaW5lZCcgfVxuICB8IHsga2luZDogJ3VucGFyc2VhYmxlJyB9XG4gIHwgbnVsbCB7XG4gIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2RpZmYgLS1jYyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ2RpZmYgLS1jb21iaW5lZCAnKSkgcmV0dXJuIHsga2luZDogJ2NvbWJpbmVkJyB9O1xuICBpZiAoIWxpbmUuc3RhcnRzV2l0aCgnZGlmZiAtLWdpdCAnKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRva2VucyA9IGxpbmUuc2xpY2UoJ2RpZmYgLS1naXQgJy5sZW5ndGgpLnRyaW0oKS5zcGxpdCgvXFxzKy8pO1xuICBpZiAodG9rZW5zLmxlbmd0aCAhPT0gMiB8fCB0b2tlbnNbMF0uc3RhcnRzV2l0aCgnXCInKSB8fCB0b2tlbnNbMV0uc3RhcnRzV2l0aCgnXCInKSkgcmV0dXJuIHsga2luZDogJ3VucGFyc2VhYmxlJyB9O1xuICByZXR1cm4geyBraW5kOiAnZmlsZScsIG9sZFBhdGg6IHN0cmlwRGlmZlByZWZpeCh0b2tlbnNbMF0pLCBuZXdQYXRoOiBzdHJpcERpZmZQcmVmaXgodG9rZW5zWzFdKSB9O1xufVxuXG4vKipcbiAqIFBhcnNlIGEgYC0tLSBhL3BhdGhgIC8gYCsrKyBiL3BhdGhgIHNpZGUgbGluZS4gYC9kZXYvbnVsbGAgbWVhbnMgdGhlIHNpZGVcbiAqIGRvZXMgbm90IGV4aXN0IChuZXctZmlsZSAvIGRlbGV0aW9uIHNpZGVzKS4gQSBxdW90ZWQgcGF0aCBpcyB1bnBhcnNlYWJsZS5cbiAqL1xuZnVuY3Rpb24gcGFyc2VEaWZmU2lkZShcbiAgbGluZTogc3RyaW5nLFxuICBtYXJrZXI6ICctLS0nIHwgJysrKydcbik6IHsga2luZDogJ3NpZGUnOyBwYXRoOiBzdHJpbmcgfCBudWxsIH0gfCB7IGtpbmQ6ICd1bnBhcnNlYWJsZScgfSB8IG51bGwge1xuICBpZiAoIWxpbmUuc3RhcnRzV2l0aChgJHttYXJrZXJ9IGApKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcCA9IGxpbmUuc2xpY2UobWFya2VyLmxlbmd0aCArIDEpO1xuICBpZiAocC5zdGFydHNXaXRoKCdcIicpKSByZXR1cm4geyBraW5kOiAndW5wYXJzZWFibGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdzaWRlJywgcGF0aDogcCA9PT0gJy9kZXYvbnVsbCcgPyBudWxsIDogc3RyaXBEaWZmUHJlZml4KHApIH07XG59XG5cbi8qKiBPbmUgZmlsZSBzZWN0aW9uIG9mIGEgcmVzcG9uc2UsIGluIHRoZSBkZWNvZGVyJ3Mgd29ya2luZyBzdGF0ZS4gKi9cbmludGVyZmFjZSBEaWZmUmVjb3JkU3RhdGUge1xuICBvbGRQYXRoOiBzdHJpbmcgfCBudWxsO1xuICBuZXdQYXRoOiBzdHJpbmcgfCBudWxsO1xuICAvKiogUmVuYW1lL2NvcHkgbWV0YWRhdGEgcHJlc2VudCAoYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCwgYGNvcHkgZnJvbWAvYGNvcHkgdG9gKTogdGhlIG5ldyBwYXRoIGlzIHRoZSBvbmx5IHRvdWNoIHRhcmdldC4gKi9cbiAgcmVuYW1lOiBib29sZWFuO1xuICBiaW5hcnk6IGJvb2xlYW47XG4gIGNvbWJpbmVkOiBib29sZWFuO1xuICBzdWJtb2R1bGU6IGJvb2xlYW47XG4gIC8qKiBBIHF1b3RlZC91bmVzY2FwYWJsZSBwYXRoOiB0aGUgcmVjb3JkIHByb2R1Y2VzIG5vIHJhbmdlLiAqL1xuICB1bnVzYWJsZTogYm9vbGVhbjtcbiAgLyoqIEEgaHVuayBoZWFkZXIgaGFzIGJlZW4gc2VlbjogbGF0ZXIgYC0tLWAvYCsrK2AtbG9va2luZyBsaW5lcyBhcmUgaHVuayBib2R5IGxpbmVzLCBub3Qgc2lkZSBoZWFkZXJzLiAqL1xuICBzYXdIdW5rOiBib29sZWFuO1xufVxuXG4vKipcbiAqIERlY29kZSBhIHVuaWZpZWQtZGlmZiByZXNwb25zZSBpbnRvIHBlci1wYXRoIGxpbmUgc2V0cy4gT25seSBodW5rIGhlYWRlcnNcbiAqIGNhcnJ5IHBvc2l0aW9uYWwgZGF0YSBcdTIwMTQgYm9keSBsaW5lcyBhcmUgaWdub3JlZCBcdTIwMTQgYW5kIGVhY2ggaGVhZGVyJ3Mgc2lkZVxuICogcmFuZ2VzIGF0dGFjaCB0byBpdHMgc2lkZSdzIHBhdGggKGAvZGV2L251bGxgIHNpZGVzIGhhdmUgbm8gcGF0aCkuXG4gKiBCaW5hcnksIGNvbWJpbmVkLCBzdWJtb2R1bGUsIGFuZCB1bnBhcnNlYWJsZSByZWNvcmRzIGVtaXQgbm90aGluZztcbiAqIHJlbmFtZS9jb3B5IHJlY29yZHMgZW1pdCB0aGUgbmV3IHNpZGUgb25seS4gYGluZGV4YCBsaW5lcyBhbmRcbiAqIGBcXCBObyBuZXdsaW5lIGF0IGVuZCBvZiBmaWxlYCBtYXJrZXJzIGFyZSBtZXRhZGF0YSBhbmQgZmFsbCB0aHJvdWdoLiBUaGVcbiAqIHVuaXZlcnNhbCB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUgYXBwbGllcyB2aWEgY29tcGxldGVMaW5lcy5cbiAqL1xuZnVuY3Rpb24gZGVjb2RlVW5pZmllZERpZmYoc3Rkb3V0OiBzdHJpbmcpOiBNYXA8c3RyaW5nLCBTZXQ8bnVtYmVyPj4ge1xuICBjb25zdCBwZXJGaWxlID0gbmV3IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PigpO1xuICBsZXQgY3VycmVudDogRGlmZlJlY29yZFN0YXRlIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgbGluZSBvZiBjb21wbGV0ZUxpbmVzKHN0ZG91dCkpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBwYXJzZURpZmZIZWFkZXIobGluZSk7XG4gICAgaWYgKGhlYWRlciAhPT0gbnVsbCkge1xuICAgICAgY3VycmVudCA9IHtcbiAgICAgICAgb2xkUGF0aDogaGVhZGVyLmtpbmQgPT09ICdmaWxlJyA/IGhlYWRlci5vbGRQYXRoIDogbnVsbCxcbiAgICAgICAgbmV3UGF0aDogaGVhZGVyLmtpbmQgPT09ICdmaWxlJyA/IGhlYWRlci5uZXdQYXRoIDogbnVsbCxcbiAgICAgICAgcmVuYW1lOiBmYWxzZSxcbiAgICAgICAgYmluYXJ5OiBmYWxzZSxcbiAgICAgICAgY29tYmluZWQ6IGhlYWRlci5raW5kID09PSAnY29tYmluZWQnLFxuICAgICAgICBzdWJtb2R1bGU6IGZhbHNlLFxuICAgICAgICB1bnVzYWJsZTogaGVhZGVyLmtpbmQgPT09ICd1bnBhcnNlYWJsZScsXG4gICAgICAgIHNhd0h1bms6IGZhbHNlXG4gICAgICB9O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50ID09PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykpIHtcbiAgICAgIGN1cnJlbnQuYmluYXJ5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBTdWJtb2R1bGUgbWFya2VyczogYSBgbW9kZSAxNjAwMDBgIG1ldGFkYXRhIGxpbmUsIG9yIGBTdWJwcm9qZWN0XG4gICAgLy8gY29tbWl0YCBsaW5lcyAodGhlaXIgb3duICsvLSBib2R5IGxpbmVzKS4gVGhlIG1vZGUgY2hlY2sgZXhjbHVkZXNcbiAgICAvLyBodW5rIGJvZHkgbGluZXMgc28gZmlsZSBjb250ZW50IHRoYXQgbWVudGlvbnMgdGhlIG1vZGUgY2FuJ3QgcmVqZWN0XG4gICAgLy8gYSByZWFsIHJlY29yZC5cbiAgICBjb25zdCBpc0JvZHlMaW5lID0gbGluZS5zdGFydHNXaXRoKCcgJykgfHwgbGluZS5zdGFydHNXaXRoKCcrJykgfHwgbGluZS5zdGFydHNXaXRoKCctJykgfHwgbGluZS5zdGFydHNXaXRoKCdcXFxcJyk7XG4gICAgaWYgKCFpc0JvZHlMaW5lICYmIGxpbmUuaW5jbHVkZXMoJ21vZGUgMTYwMDAwJykpIHtcbiAgICAgIGN1cnJlbnQuc3VibW9kdWxlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5pbmNsdWRlcygnU3VicHJvamVjdCBjb21taXQnKSkge1xuICAgICAgY3VycmVudC5zdWJtb2R1bGUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykgfHxcbiAgICAgIGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIHRvICcpIHx8XG4gICAgICBsaW5lLnN0YXJ0c1dpdGgoJ2NvcHkgZnJvbSAnKSB8fFxuICAgICAgbGluZS5zdGFydHNXaXRoKCdjb3B5IHRvICcpXG4gICAgKSB7XG4gICAgICBjdXJyZW50LnJlbmFtZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFjdXJyZW50LnNhd0h1bmspIHtcbiAgICAgIGNvbnN0IG9sZFNpZGUgPSBwYXJzZURpZmZTaWRlKGxpbmUsICctLS0nKTtcbiAgICAgIGlmIChvbGRTaWRlICE9PSBudWxsKSB7XG4gICAgICAgIGlmIChvbGRTaWRlLmtpbmQgPT09ICd1bnBhcnNlYWJsZScpIGN1cnJlbnQudW51c2FibGUgPSB0cnVlO1xuICAgICAgICBlbHNlIGN1cnJlbnQub2xkUGF0aCA9IG9sZFNpZGUucGF0aDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBuZXdTaWRlID0gcGFyc2VEaWZmU2lkZShsaW5lLCAnKysrJyk7XG4gICAgICBpZiAobmV3U2lkZSAhPT0gbnVsbCkge1xuICAgICAgICBpZiAobmV3U2lkZS5raW5kID09PSAndW5wYXJzZWFibGUnKSBjdXJyZW50LnVudXNhYmxlID0gdHJ1ZTtcbiAgICAgICAgZWxzZSBjdXJyZW50Lm5ld1BhdGggPSBuZXdTaWRlLnBhdGg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBodW5rID0gSFVOS19IRUFERVIuZXhlYyhsaW5lKTtcbiAgICBpZiAoaHVuayAhPT0gbnVsbCkge1xuICAgICAgY3VycmVudC5zYXdIdW5rID0gdHJ1ZTtcbiAgICAgIGVtaXRIdW5rUmFuZ2UocGVyRmlsZSwgY3VycmVudCwgaHVuayk7XG4gICAgfVxuICB9XG4gIHJldHVybiBwZXJGaWxlO1xufVxuXG4vKiogQXR0cmlidXRlIG9uZSBodW5rIGhlYWRlcidzIHBlci1zaWRlIHJhbmdlcyB0byBpdHMgcmVjb3JkJ3MgcGF0aHMuICovXG5mdW5jdGlvbiBlbWl0SHVua1JhbmdlKHBlckZpbGU6IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PiwgcmVjb3JkOiBEaWZmUmVjb3JkU3RhdGUsIGh1bms6IFJlZ0V4cEV4ZWNBcnJheSk6IHZvaWQge1xuICBpZiAocmVjb3JkLmJpbmFyeSB8fCByZWNvcmQuY29tYmluZWQgfHwgcmVjb3JkLnN1Ym1vZHVsZSB8fCByZWNvcmQudW51c2FibGUpIHJldHVybjtcbiAgY29uc3Qgb2xkU3RhcnQgPSBOdW1iZXIucGFyc2VJbnQoaHVua1sxXSwgMTApO1xuICBjb25zdCBvbGRDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICBjb25zdCBuZXdTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzNdLCAxMCk7XG4gIGNvbnN0IG5ld0NvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gIC8vIFJlbmFtZS9jb3B5OiB0aGUgbmV3IHBhdGggaXMgdGhlIHRvdWNoIHRhcmdldDsgdGhlIG9sZCBzaWRlIGlzIGRyb3BwZWRcbiAgLy8gKHRoZSBvbGQgcGF0aCBtYXkgbm90IGV4aXN0IG9uIGRpc2sgXHUyMDE0IGl0IHdhcyByZW5hbWVkIGF3YXkpLlxuICBpZiAocmVjb3JkLnJlbmFtZSkge1xuICAgIGlmIChyZWNvcmQubmV3UGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm5ld1BhdGgsIG5ld1N0YXJ0LCBuZXdDb3VudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChyZWNvcmQub2xkUGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm9sZFBhdGgsIG9sZFN0YXJ0LCBvbGRDb3VudCk7XG4gIGlmIChyZWNvcmQubmV3UGF0aCAhPT0gbnVsbCkgYWRkTGluZXMocGVyRmlsZSwgcmVjb3JkLm5ld1BhdGgsIG5ld1N0YXJ0LCBuZXdDb3VudCk7XG59XG5cbi8qKiBBZGQgYGNvdW50YCBjb25zZWN1dGl2ZSAxLWJhc2VkIGxpbmVzIHN0YXJ0aW5nIGF0IGBzdGFydGAgdG8gYHBhdGhgJ3Mgc2V0LiAqL1xuZnVuY3Rpb24gYWRkTGluZXMocGVyRmlsZTogTWFwPHN0cmluZywgU2V0PG51bWJlcj4+LCBwYXRoOiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIsIGNvdW50OiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKHN0YXJ0IDwgMSB8fCBjb3VudCA8PSAwKSByZXR1cm47XG4gIGxldCBsaW5lcyA9IHBlckZpbGUuZ2V0KHBhdGgpO1xuICBpZiAobGluZXMgPT09IHVuZGVmaW5lZCkge1xuICAgIGxpbmVzID0gbmV3IFNldCgpO1xuICAgIHBlckZpbGUuc2V0KHBhdGgsIGxpbmVzKTtcbiAgfVxuICBmb3IgKGxldCBuID0gc3RhcnQ7IG4gPCBzdGFydCArIGNvdW50OyBuKyspIGxpbmVzLmFkZChuKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBgZ2l0IGJsYW1lIC1MYCBjb21tYW5kLXRleHQgbWF0Y2hlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogTWF0Y2ggYSBgZ2l0IGJsYW1lIC1MIE4sTSA8ZmlsZT5gIGludm9jYXRpb24gZnJvbSBjb21tYW5kIHRleHQ6IHRoZSBleGFjdFxuICogbGl0ZXJhbCBgTixNYCByYW5nZSBmcm9tIHRoZSBgLUxgIHZhbHVlIGFuZCB0aGUgc2luZ2xlIHBhdGggcG9zaXRpb25hbFxuICogdGhhdCBmb2xsb3dzIGl0IChlYXJsaWVyIHBvc2l0aW9uYWxzIGFyZSByZXZpc2lvbnMpLiBgZ2l0IGxvZyAtTGAgZW1iZWRzXG4gKiB0aGUgcGF0aCBpbiBpdHMgc3BlYyBhbmQgcGFyc2UtY29tbWFuZC50cyBhbHJlYWR5IGNvdmVycyBpdDsgYmxhbWUgdGFrZXNcbiAqIHRoZSBwYXRoIGFzIGEgcG9zaXRpb25hbCwgd2hpY2ggdGhlIGNvbW1hbmQtb25seSBwYXJzZXIgZG9lcyBub3QgaGFuZGxlLlxuICovXG5mdW5jdGlvbiBtYXRjaEJsYW1lUmFuZ2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBzdGFydDogbnVtYmVyXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXI7IGZpbGVBcmc6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNwZWNJZHggPSAtMTtcbiAgY29uc3QgcG9zaXRpb25hbHM6IEFycmF5PHsgYXJnOiBzdHJpbmc7IGlkeDogbnVtYmVyIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGFyZ3YubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJndltpXTtcbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgYXJndi5sZW5ndGg7IGorKykgcG9zaXRpb25hbHMucHVzaCh7IGFyZzogYXJndltqXSwgaWR4OiBqIH0pO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGlmIChhID09PSAnLUwnKSB7XG4gICAgICBzcGVjID0gYXJndltpICsgMV0gPz8gbnVsbDtcbiAgICAgIHNwZWNJZHggPSBpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHtcbiAgICAgIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgICAgc3BlY0lkeCA9IGk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBwb3NpdGlvbmFscy5wdXNoKHsgYXJnOiBhLCBpZHg6IGkgfSk7XG4gIH1cbiAgaWYgKHNwZWMgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBtID0gL14oXFxkKyksKFxcZCspJC8uZXhlYyhzcGVjKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBmaWxlcyA9IHBvc2l0aW9uYWxzLmZpbHRlcigocCkgPT4gcC5pZHggPiBzcGVjSWR4KTtcbiAgaWYgKGZpbGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7XG4gICAgbGluZVN0YXJ0OiBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApLFxuICAgIGxpbmVFbmQ6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCksXG4gICAgZmlsZUFyZzogZmlsZXNbMF0uYXJnXG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBEZXJpdmVzIHByZWNpc2UgcGVyLWZpbGUgcmVhZCByYW5nZXMgZnJvbSBhIHJlc3BvbnNlLXByb2R1Y2luZyBjb21tYW5kOlxuICogY29tbWFuZCBnYXRpbmcsIHNjb3BlIHJlc3RyaWN0aW9uIGFnYWluc3QgdGhlIGNvbW1hbmQncyBkZWNsYXJlZCByb290cyxcbiAqIHNlYXJjaC1sYXlvdXQgZGVjb2RpbmcsIHVuaWZpZWQtZGlmZiBkZWNvZGluZywgY29hbGVzY2luZywgYW5kIHRoZVxuICogZmFpbC1jbG9zZWQgdHJ1bmNhdGlvbi9ob3N0aWxlLW91dHB1dCBydWxlcy4gUmV0dXJucyBbXSBmb3IgYW55dGhpbmcgbm90XG4gKiByZXNwb25zZS1kZXJpdmFibGUgb3Igbm90IGZ1bGx5IG9ic2VydmVkLlxuICpcbiAqIFBoYXNlIDNhIGNvdmVycyB0aGUgZ3JlcC9yaXBncmVwIGZhbWlseSAoYHJnYCwgYGdyZXBgLCBgZWdyZXBgLCBgZmdyZXBgLFxuICogYGdpdCBncmVwYCk7IFBoYXNlIDNiIHRoZSBkaWZmLWZvcm0gYGdpdCBkaWZmYC9gZ2l0IHNob3dgL2BnaXQgbG9nIC1wYFxuICogdW5pZmllZC1kaWZmIGRlY29kZXI7IFBoYXNlIDNjIHRoZSBgZ2l0IGJsYW1lIC1MIE4sTSBmaWxlYCBjb21tYW5kLXRleHRcbiAqIG1hdGNoZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVJlc3BvbnNlKGlucHV0OiBSZXNwb25zZVBhcnNlSW5wdXQpOiBSZXNwb25zZVNwYW5bXSB7XG4gIGNvbnN0IHsgY29tbWFuZCwgY3dkLCBzdGRvdXQgfSA9IGlucHV0O1xuXG4gIC8vIFdhbGsgdGhlIHNpbXBsZSBjb21tYW5kcyB0cmFja2luZyBgY2RgLCBleGFjdGx5IGxpa2UgcGFyc2UtY29tbWFuZC50cy5cbiAgLy8gVGhlIHJlc3BvbnNlIGlzIGF0dHJpYnV0ZWQgdG8gdGhlIEZJUlNUIGdhdGVkIHN0YWdlIChsZWZ0LXRvLXJpZ2h0OyBhXG4gIC8vIGxhdGVyIHN0YWdlIG5ldmVyIG92ZXJyaWRlcyBhbiBlYXJsaWVyIGdhdGVkIG9uZSk6IGluIGEgcGlwZWxpbmUgdGhlXG4gIC8vIGZpbmFsIHN0YWdlJ3Mgc3Rkb3V0IGlzIHRoZSBnYXRlZCBzdGFnZSdzIG91dHB1dCBcdTIwMTQgaGVhZC90YWlsL3djL3NvcnQvXG4gIC8vIHVuaXEvY3V0IG9ubHkgdHJ1bmNhdGUsIHJlb3JkZXIsIG9yIGRlZHVwZSwgYW5kIHRoZSB0ZXJtaW5hdGluZy1uZXdsaW5lXG4gIC8vIHJ1bGUgaGFuZGxlcyB0aGUgY3V0IFx1MjAxNCB3aGlsZSBhIHJlbnVtYmVyaW5nIHN0YWdlIChncmVwIC1uLCBubCwgY2F0IC1uLFxuICAvLyBhd2ssIHNlZCkgdHVybnMgdGhlIHJlY29yZHMgaW50byBzdHJlYW0gcG9zaXRpb25zLCBzbyBzdWNoIHBpcGVsaW5lc1xuICAvLyBmYWlsIGNsb3NlZCBiZWxvdy4gSW4gYSBgO2AvYCYmYC9gfHxgL2AmYC9uZXdsaW5lIGNoYWluIGV2ZXJ5IHNpYmxpbmdcbiAgLy8gc3RhZ2UncyBvdXRwdXQgbWl4ZXMgaW50byB0aGUgU0FNRSByZXNwb25zZSwgc28gdGhlIGNoYWluIGlzXG4gIC8vIGF0dHJpYnV0YWJsZSBvbmx5IHdoZW4gZXZlcnkgc2libGluZyAoZWl0aGVyIGRpcmVjdGlvbikgcGFzc2VzIHRoZSBzYW1lXG4gIC8vIHByb3ZhYmx5LXZlcmJhdGltIGNoZWNrIHRoZSBwaXBlIHN0YWdlcyBnZXQgXHUyMDE0IGEgY3JhZnRlZCBmaWxlIHJlYWQgYnlcbiAgLy8gYW55IHNpYmxpbmcgd291bGQgZGVjb2RlIGFzIHBoYW50b20gdG91Y2hlcyBvdGhlcndpc2UuIGBjZGAgdHJhY2tpbmdcbiAgLy8gYXBwbGllcyBvbmx5XG4gIC8vIHVudGlsIHRoZSBmaXJzdCBnYXRlZCBzdGFnZSBpcyBmb3VuZDogdGhlIGV2aWRlbmNlIHdhcyBwcm9kdWNlZCBpbiB0aGF0XG4gIC8vIGRpcmVjdG9yeSwgYW5kIGEgYGNkYCBpbiBhIGxhdGVyIHN0YWdlIHNheXMgbm90aGluZyBhYm91dCB3aGVyZSB0aGVcbiAgLy8gcmVzcG9uc2Ugd2FzIG1hZGUuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgZ2F0ZWQ6IEdhdGVkQ29tbWFuZCB8IG51bGwgPSBudWxsO1xuICAvLyBXaGV0aGVyIHRoZSBnYXRlZCBzdGFnZSdzIHN0ZGluIGNhbWUgZnJvbSBhIHBpcGUgXHUyMDE0IHRoZSBzaWduYWwgdGhhdCBpdHNcbiAgLy8gcmVjb3JkcyBhcmUgc3RyZWFtIHBvc2l0aW9ucyB3aGVuIG5vIHNlYXJjaCByb290cyB3ZXJlIGdpdmVuLlxuICBsZXQgZ2F0ZWRQcmVjZWRlZEJ5OiBPcGVyYXRvciA9ICdzdGFydCc7XG4gIC8vIFdoZXRoZXIgdGhlIGdhdGVkIHN0YWdlJ3Mgb3duIHRleHQgY2FycmllcyBhbiBVTlFVT1RFRCBgPGAgXHUyMDE0IGEgc3RkaW5cbiAgLy8gcmVkaXJlY3QsIHN0YW5kYWxvbmUgb3IgZ2x1ZWQgaW5zaWRlIGEgdG9rZW4gKGByZyBuZWVkbGU8Y3JhZnRlZC50eHRgLFxuICAvLyBhIGNvbnN1bWVkIGAtZWAvYC1mYCB2YWx1ZSkuIFRoZSBzdGRpbi1mZWQgcnVsZSBtdXN0IHNlZSBpdCBldmVuIHdoZW5cbiAgLy8gbm8gc3RhbmRhbG9uZSBgPGAgdG9rZW4gc3Vydml2ZXMgYXJndiBzcGxpdHRpbmcuIFF1b3RlLWF3YXJlOiBhIHF1b3RlZFxuICAvLyBsaXRlcmFsIGA8YCBpbiBhIHBhdHRlcm4gKGByZyAtbiAnPGRpdj4nYCkgaXMgbm90IGEgcmVkaXJlY3QuXG4gIGxldCBnYXRlZFJlZGlyZWN0ID0gZmFsc2U7XG4gIC8vIFdoZXRoZXIgdGhlIGdhdGVkIHN0YWdlJ3Mgc3RkaW4gY29tZXMgZnJvbSBhIGA8PGAvYDw8LWAgSEVSRURPQyBib2R5IFx1MjAxNFxuICAvLyB0aGUgc3BsaXR0ZXIgc3RyaXBzIHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgZnJvbSB0aGUgc3RhZ2UgdGV4dCwgc28gb25seVxuICAvLyB0aGUgcGVyLXN0YWdlIGZsYWcgc2VlcyB0aGUgcmVkaXJlY3QuXG4gIGxldCBnYXRlZEhlcmVkb2MgPSBmYWxzZTtcbiAgY29uc3Qgc3BsaXQgPSBzcGxpdFRvcExldmVsKGNvbW1hbmQpO1xuICAvLyBBIEJhc2ggcGFyc2UgZXJyb3IgbWVhbnMgbm90aGluZyBleGVjdXRlZCAoYmFzaCBleGl0cyAyIGF0IHBhcnNlIHRpbWUpIFx1MjAxNFxuICAvLyB0aGUgcmVzcG9uc2UgY291bGQgbm90IGhhdmUgYmVlbiBwcm9kdWNlZCBieSB0aGlzIGNvbW1hbmQsIHNvIGZhaWxcbiAgLy8gY2xvc2VkIHJhdGhlciB0aGFuIGF0dHJpYnV0ZSBpdCB0byBoYWxmLXBhcnNlZCBzdGFnZXMuXG4gIGlmIChzcGxpdC5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIFtdO1xuICBjb25zdCBwYXJ0cyA9IHNwbGl0LnN0YWdlcztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHNpbXBsZSA9IHBhcnRzW2ldO1xuICAgIGNvbnN0IGFyZ3YgPSBhcmd2T2Yoc2ltcGxlLnRleHQpO1xuICAgIGlmIChhcmd2ID09PSBudWxsIHx8IGFyZ3YubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBpZiAoYXJndlswXSA9PT0gJ2NkJykge1xuICAgICAgaWYgKGdhdGVkID09PSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCAmJiB0YXJnZXQgIT09ICctJyAmJiAhaGFzU2hlbGxFeHBhbnNpb24odGFyZ2V0KSkge1xuICAgICAgICAgIGN1cnJlbnREaXIgPSByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGdhdGVkICE9PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoU0VBUkNIX0JJTlMuaGFzKGFyZ3ZbMF0pKSB7XG4gICAgICBnYXRlZCA9IHsga2luZDogJ3NlYXJjaCcsIGFyZ3YsIHN0YXJ0OiAxLCBkaXI6IG51bGwsIGRpclVucmVzb2x2YWJsZTogZmFsc2UgfTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdnaXQnKSB7XG4gICAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2KTtcbiAgICAgIGlmIChzdWIgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHsgYXJndiwgc3RhcnQ6IHN1Yi5zdGFydCwgZGlyOiBzdWIuZGlyLCBkaXJVbnJlc29sdmFibGU6IHN1Yi5kaXJVbnJlc29sdmFibGUgfTtcbiAgICAgICAgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnZ3JlcCcpIGdhdGVkID0geyBraW5kOiAnc2VhcmNoJywgLi4uYmFzZSB9O1xuICAgICAgICAvLyBgZ2l0IHNob3cgPHJldj46PHBhdGg+YCBzdHJlYW1zIHRoZSBibG9iJ3MgUkFXIGNvbnRlbnQsIG5ldmVyIGFcbiAgICAgICAgLy8gZGlmZiBcdTIwMTQgYSBkaWZmLXNoYXBlZCBibG9iIG11c3Qgbm90IGRlY29kZSBpbnRvIGZhYnJpY2F0ZWQgdG91Y2hlc1xuICAgICAgICAvLyBvbiB0aGUgZmlsZXMgaXRzIGNvbnRlbnQgbmFtZXMsIHNvIHRoZSBjb250ZW50IGlkaW9tIGlzIGV4Y2x1ZGVkXG4gICAgICAgIC8vIGZyb20gdGhlIGRpZmYgZ2F0ZS4gYGdpdCBkaWZmIDxyZXY+OjxwYXRoPmAgZXJyb3JzIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gZW1pdHRpbmcgY29udGVudCwgc28gb25seSBgc2hvd2AgbmVlZHMgdGhlIGNoZWNrOyB0aGUgdHdvLWFyZ1xuICAgICAgICAvLyBibG9iLWJsb2IgZm9ybSBgZ2l0IGRpZmYgPHJldj46PHBhdGg+IDxyZXY+OjxwYXRoPmAgRE9FUyBlbWl0IGFcbiAgICAgICAgLy8gZGlmZiBuYW1pbmcgd29ya2luZy10cmVlIHBhdGhzIGdpdCBuZXZlciByZWFkIGFuZCBpcyByZWplY3RlZCBpblxuICAgICAgICAvLyB0aGUgZGlmZiBicmFuY2ggYmVsb3cuXG4gICAgICAgIGVsc2UgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnc2hvdycgJiYgIWhhc1JldlBhdGhBcmcoYXJndiwgc3ViLnN0YXJ0KSkgZ2F0ZWQgPSB7IGtpbmQ6ICdkaWZmJywgLi4uYmFzZSB9O1xuICAgICAgICBlbHNlIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ2RpZmYnKSBnYXRlZCA9IHsga2luZDogJ2RpZmYnLCAuLi5iYXNlIH07XG4gICAgICAgIGVsc2UgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAnbG9nJyAmJiBoYXNEaWZmUGF0Y2hGbGFnKGFyZ3YsIHN1Yi5zdGFydCkpIGdhdGVkID0geyBraW5kOiAnZGlmZicsIC4uLmJhc2UgfTtcbiAgICAgICAgZWxzZSBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdibGFtZScpIGdhdGVkID0geyBraW5kOiAnYmxhbWUnLCAuLi5iYXNlIH07XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChnYXRlZCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgZ2F0ZWRQcmVjZWRlZEJ5ID0gc2ltcGxlLnByZWNlZGVkQnk7XG4gICAgZ2F0ZWRSZWRpcmVjdCA9IGhhc1VucXVvdGVkUmVkaXJlY3Qoc2ltcGxlLnRleHQpO1xuICAgIGdhdGVkSGVyZWRvYyA9IHNpbXBsZS5oZXJlZG9jID8/IGZhbHNlO1xuICAgIC8vIEV2ZXJ5IE9USEVSIHN0YWdlJ3MgcmVjb3JkcyBjYW4gcmVhY2ggdGhlIHJlc3BvbnNlLCBzbyBlYWNoIG11c3QgYmVcbiAgICAvLyBwcm92YWJseSB2ZXJiYXRpbSBcdTIwMTQgdGhlIGRlZmF1bHQgb2YgaXNSZW51bWJlcmluZ0ZpbHRlciBpcyBjbG9zZWQsIHNvXG4gICAgLy8gYW55IGJpbiBvdXRzaWRlIHRoZSB2ZXJiYXRpbSBhbGxvd2xpc3QgKHB5dGhvbiwgcnVieSwgbWF3aywgXHUyMDI2KSBtYXlcbiAgICAvLyByZW51bWJlciBvciByZXdyaXRlIHRoZSByZWNvcmRzLCBkZXN0cm95IHRoZSBmaWxlLWxpbmUgbWFwcGluZyB0aGV5XG4gICAgLy8gY2FycnksIGFuZCB0aGUgcGlwZWxpbmUgZmFpbHMgY2xvc2VkOiBhdHRyaWJ1dGUgbm90aGluZy4gVGhhdCBjb3ZlcnNcbiAgICAvLyB0aGUgcGlwZSBzdGFnZXMgb2YgdGhlIHNhbWUgcGlwZWxpbmUgQU5EIHRoZSBjaGFpbiBzaWJsaW5ncyBqb2luZWRcbiAgICAvLyBieSBgO2AsIGAmJmAsIGB8fGAsIGAmYCwgb3IgYSBuZXdsaW5lIFx1MjAxNCBpbiBlaXRoZXIgZGlyZWN0aW9uIFx1MjAxNCB3aG9zZVxuICAgIC8vIG91dHB1dCBtaXhlcyBpbnRvIHRoZSBzYW1lIHJlc3BvbnNlOiBhIGNyYWZ0ZWQgZmlsZSByZWFkIGJ5IGFueVxuICAgIC8vIHNpYmxpbmcgZGVjb2RlcyBhcyBwaGFudG9tIHRvdWNoZXMsIHNvIGEgY2hhaW4gaXMgYXR0cmlidXRhYmxlIG9ubHlcbiAgICAvLyB3aGVuIGV2ZXJ5IHNpYmxpbmcgcGFzc2VzIHRoZSBzYW1lIHZlcmJhdGltIGNoZWNrLiBgY2RgIHN0YWdlcyBhcmVcbiAgICAvLyBza2lwcGVkIGFib3ZlICh0aGVpciBvdXRwdXQgaXMgZW1wdHkpLCBhbmQgYSBgfGAtam9pbmVkIGZlZWRlclxuICAgIC8vIEVBUkxJRVIgaW4gdGhlIHBpcGVsaW5lIGlzIGNvbnN1bWVkIGJ5IHRoZSBnYXRlZCBzdGFnZSBcdTIwMTQgYSBzZWFyY2hcbiAgICAvLyB3aXRoIGV4cGxpY2l0IHJvb3RzIGlnbm9yZXMgc3RkaW4sIHNvIHRoZSBmZWVkZXIncyByZWNvcmRzIG5ldmVyXG4gICAgLy8gcmVhY2ggdGhlIHJlc3BvbnNlLlxuICAgIGZvciAobGV0IGogPSAwOyBqIDwgcGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChqID09PSBpKSBjb250aW51ZTtcbiAgICAgIGlmIChqIDwgaSkge1xuICAgICAgICAvLyBBIGZlZWRlcidzIG91dHB1dCBpcyBjb25zdW1lZCBvbmx5IHdoZW4gRVZFUlkgcGFydCBiZXR3ZWVuIGl0XG4gICAgICAgIC8vIGFuZCB0aGUgZ2F0ZWQgc3RhZ2UgaXMgcGlwZS1qb2luZWQgXHUyMDE0IGEgYDtgL2AmJmAvXHUyMDI2IGFueXdoZXJlIGluXG4gICAgICAgIC8vIGJldHdlZW4gbWFrZXMgaXQgYSBjaGFpbiBzaWJsaW5nIHdob3NlIG91dHB1dCByZWFjaGVzIHRoZVxuICAgICAgICAvLyByZXNwb25zZSAodGhyb3VnaCB0aGUgc3RhZ2VzIGJldHdlZW4gdGhlbSkuXG4gICAgICAgIGxldCBjb25zdW1lZCA9IHRydWU7XG4gICAgICAgIGZvciAobGV0IGsgPSBqICsgMTsgayA8PSBpICYmIGNvbnN1bWVkOyBrKyspIHtcbiAgICAgICAgICBpZiAocGFydHNba10ucHJlY2VkZWRCeSAhPT0gJ3BpcGUnKSBjb25zdW1lZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjb25zdW1lZCkgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzaWJsaW5nVGV4dCA9IHBhcnRzW2pdLnRleHQ7XG4gICAgICBjb25zdCBzaWJsaW5nQXJndiA9IGFyZ3ZPZihzaWJsaW5nVGV4dCk7XG4gICAgICBpZiAoc2libGluZ0FyZ3YgPT09IG51bGwgfHwgc2libGluZ0FyZ3YubGVuZ3RoID09PSAwIHx8IHNpYmxpbmdBcmd2WzBdID09PSAnY2QnKSBjb250aW51ZTtcbiAgICAgIC8vIEFuIHVucXVvdGVkIGA8YCBcdTIwMTQgZXZlbiBHTFVFRCBpbnNpZGUgYSBmbGFnLCBwYXR0ZXJuLCBvciB2YWx1ZSB0b2tlblxuICAgICAgLy8gKGBoZWFkIC0yPGNyYWZ0ZWQudHh0YCwgYGdyZXAgbmVlZGxlPGNyYWZ0ZWQudHh0YCwgYC1lIG5lZWRsZTxmYCkgXHUyMDE0XG4gICAgICAvLyByZWRpcmVjdHMgdGhlIHN0YWdlJ3Mgc3RkaW4gdG8gYSBmaWxlLCBzbyBpdHMgcmVjb3JkcyBjb21lIGZyb20gdGhhdFxuICAgICAgLy8gZmlsZSwgbm90IHRoZSBwaXBlOiBhIGNyYWZ0ZWQgcmVjb3JkIGRlY29kZXMgYXMgYSBwaGFudG9tIHRvdWNoLCBzb1xuICAgICAgLy8gZmFpbCBjbG9zZWQgbGlrZSBhbnkgb3RoZXIgZmlsZSBvcGVyYW5kLiBRdW90ZS1hd2FyZTogYSBxdW90ZWRcbiAgICAgIC8vIGxpdGVyYWwgYDxgIGluIGEgcGF0dGVybiAoYHJnIC1uICc8ZGl2PidgKSBpcyBub3QgYSByZWRpcmVjdC5cbiAgICAgIGlmIChoYXNVbnF1b3RlZFJlZGlyZWN0KHNpYmxpbmdUZXh0KSkgcmV0dXJuIFtdO1xuICAgICAgLy8gQSBoZXJlZG9jIChgY2F0IDw8J0VPRidgKSBmZWVkcyB0aGUgc3RhZ2UncyBzdGRpbiBmcm9tIGl0cyBCT0RZIFx1MjAxNCBhXG4gICAgICAvLyBjcmFmdGVkIGJvZHkgaXMgdGhlIHNhbWUgZmFicmljYXRlZC1yZWNvcmQgc291cmNlIGFzIGEgY3JhZnRlZCBmaWxlLlxuICAgICAgLy8gVGhlIHNwbGl0dGVyIHN0cmlwcyBgPDxgIGZyb20gdGhlIHRleHQsIHNvIG9ubHkgdGhlIHBlci1zdGFnZSBmbGFnXG4gICAgICAvLyBzZWVzIHRoZSByZWRpcmVjdC5cbiAgICAgIGlmIChwYXJ0c1tqXS5oZXJlZG9jKSByZXR1cm4gW107XG4gICAgICBpZiAoaXNSZW51bWJlcmluZ0ZpbHRlcihzaWJsaW5nQXJndikpIHJldHVybiBbXTtcbiAgICB9XG4gIH1cbiAgaWYgKGdhdGVkID09PSBudWxsIHx8IGdhdGVkLmRpclVucmVzb2x2YWJsZSkgcmV0dXJuIFtdO1xuXG4gIC8vIFRoZSBkaXJlY3Rvcnkgc2VhcmNoIHBhdGhzIGFyZSByZWxhdGl2ZSB0byBcdTIwMTQgdGhlIGBnaXQgLUNgIHRhcmdldCB3aGVuXG4gIC8vIHByZXNlbnQsIG90aGVyd2lzZSB0aGUgc2hlbGwgY3dkIGFmdGVyIGFueSBgY2RgLlxuICBjb25zdCBlZmZlY3RpdmVEaXIgPSBnYXRlZC5kaXIgIT09IG51bGwgPyByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBnYXRlZC5kaXIpIDogY3VycmVudERpcjtcblxuICAvLyBgZ2l0IGJsYW1lIC1MIE4sTSBmaWxlYCByZXNvbHZlcyBzdHJhaWdodCBmcm9tIHRoZSBjb21tYW5kIHRleHQ7IHRoZVxuICAvLyByZXNwb25zZSdzIGNvbnRlbnQgaXMgaXJyZWxldmFudCB0byBpdCwgc28gdGhlIEFOU0kgcmVqZWN0aW9uIGFuZCB0aGVcbiAgLy8gdHJ1bmNhdGlvbiBnYXRlIGJlbG93IFx1MjAxNCBib3RoIHJlc3BvbnNlLWRlcml2ZWQgZGVjb2RlIGdhdGVzIFx1MjAxNCBtdXN0IG5vdFxuICAvLyBzdXBwcmVzcyBpdC5cbiAgaWYgKGdhdGVkLmtpbmQgPT09ICdibGFtZScpIHtcbiAgICBjb25zdCBtID0gbWF0Y2hCbGFtZVJhbmdlKGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0KTtcbiAgICBpZiAobSA9PT0gbnVsbCB8fCBoYXNTaGVsbEV4cGFuc2lvbihtLmZpbGVBcmcpIHx8IC9bKj9dLy50ZXN0KG0uZmlsZUFyZykpIHJldHVybiBbXTtcbiAgICByZXR1cm4gW3sgbGluZVN0YXJ0OiBtLmxpbmVTdGFydCwgbGluZUVuZDogbS5saW5lRW5kLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGVmZmVjdGl2ZURpciwgbS5maWxlQXJnKSB9XTtcbiAgfVxuXG4gIC8vIEFOU0kgZXNjYXBlIGJ5dGVzIHJlamVjdCB0aGUgd2hvbGUgcGFyc2U6IG5laXRoZXIgcmcvZ3JlcCBub3IgZ2l0IGVtaXRcbiAgLy8gY29sb3Igd2hlbiBwaXBlZCwgc28gYW4gRVNDIGJ5dGUgbWVhbnMgc29tZXRoaW5nIGRlbGliZXJhdGUgaXMgZ29pbmcgb24uXG4gIGlmIChzdGRvdXQuaW5jbHVkZXMoJ1xcdTAwMWInKSkgcmV0dXJuIFtdO1xuXG4gIC8vIFRoZSBhZGFwdGVyLXN1cHBsaWVkIHRydW5jYXRlZCBmbGFnIChDbGF1ZGUgcmF3T3V0cHV0UGF0aCBzZXQgXHUyMUQyIGlubGluZVxuICAvLyBzdGRvdXQgaXMgb25seSBhIHByZXZpZXcpIGRlY2xhcmVzIHRoZSByZXNwb25zZS1kZXJpdmVkIGRlY29kZVxuICAvLyB1bnRydXN0d29ydGh5IFx1MjAxNCBmYWlsIGNsb3NlZCwgcGFyc2Ugbm90aGluZywgaW52ZW50IG5vIHRvdWNoZXMuXG4gIC8vIGBpbnRlcnJ1cHRlZGAgaXMgdGhlIHBsYW4ncyBjb21wbGV0ZS1yZWNvcmRzIHJlZ2ltZTogZnVsbHktdGVybWluYXRlZFxuICAvLyByZWNvcmRzIHBhcnNlIGFuZCB0aGUgaW5jb21wbGV0ZSB0YWlsIGRyb3BzIHZpYSB0aGUgdW5jb25kaXRpb25hbFxuICAvLyB0ZXJtaW5hdGluZy1uZXdsaW5lIHJ1bGUsIHdoaWNoIHRoZSBkZWZhdWx0IHBhdGggYWxyZWFkeSBhcHBsaWVzLlxuICBpZiAoaW5wdXQudHJ1bmNhdGVkKSByZXR1cm4gW107XG5cbiAgaWYgKGdhdGVkLmtpbmQgPT09ICdkaWZmJykge1xuICAgIC8vIFR3by1hcmcgYmxvYi1ibG9iIGBnaXQgZGlmZiA8cmV2Pjo8cGF0aD4gPHJldj46PHBhdGg+YCBlbWl0cyBhIG5vcm1hbFxuICAgIC8vIHVuaWZpZWQgZGlmZiBuYW1pbmcgd29ya2luZy10cmVlIHBhdGhzIHdoaWxlIGdpdCByZWFkcyBvbmx5IGhpc3RvcmljYWxcbiAgICAvLyBibG9icyBcdTIwMTQgZGVjb2RpbmcgaXQgd291bGQgZmFicmljYXRlIHRvdWNoZXMgb24gZmlsZXMgZ2l0IG5ldmVyIHJlYWQsXG4gICAgLy8gc28gYSBwb3NpdGlvbmFsIGNhcnJ5aW5nIGByZXY6cGF0aGAgKGFueSBgOmAtY29udGFpbmluZyBwb3NpdGlvbmFsXG4gICAgLy8gdGhhdCBpcyBub3QgYW4gZXhpc3RpbmcgZmlsZSkgcmVqZWN0cyB0aGUgZGVjb2RlIG91dHJpZ2h0LlxuICAgIGlmIChoYXNEaWZmUmV2UGF0aEFyZyhnYXRlZC5hcmd2LCBnYXRlZC5zdGFydCwgZWZmZWN0aXZlRGlyKSkgcmV0dXJuIFtdO1xuICAgIC8vIERpZmYtZm9ybSBwYXRocyBhcmUgcmVwby1yb290LXJlbGF0aXZlIHJlZ2FyZGxlc3Mgb2YgY3dkLCBzbyB0aGV5XG4gICAgLy8gcmVzb2x2ZSBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290IGRpc2NvdmVyZWQgZnJvbSB0aGUgZWZmZWN0aXZlIGRpclxuICAgIC8vIChhIGAuZ2l0YCBlbnRyeSBtYXJrcyBpdCBcdTIwMTQgbm8gc3VicHJvY2VzcykuIFRoZSByZXBvIHJvb3QgaXMgYWxzbyB0aGVcbiAgICAvLyBwZXJtaXR0ZWQgcm9vdDogYSB0cmF2ZXJzYWwgcGF0aCBub3JtYWxpemVzIG91dHNpZGUgaXQgYW5kIGlzIHJlamVjdGVkXG4gICAgLy8gYnkgdGhlIHNhbWUgY29udGFpbm1lbnQgY2hlY2suIGAtLXJlbGF0aXZlYCAoYmFyZSkgcmUtYW5jaG9ycyB0byB0aGVcbiAgICAvLyBjd2QgYW5kIGAtLXJlbGF0aXZlPTxwYXRoPmAgdG8gYSBwYXRoIHJlc29sdmVkIGFnYWluc3QgdGhlIHdvcmt0cmVlXG4gICAgLy8gcm9vdCBcdTIwMTQgYm90aCBkZWNvZGUgYWdhaW5zdCB0aGF0IGJhc2UgaW5zdGVhZCAoYSBzaGVsbC1leHBhbmRlZCBvclxuICAgIC8vIGVtcHR5IHZhbHVlIGlzIHVucmVzb2x2YWJsZSBhbmQgZmFpbHMgY2xvc2VkKS5cbiAgICBjb25zdCByZXBvUm9vdCA9IGZpbmRHaXRSb290KGVmZmVjdGl2ZURpcik7XG4gICAgaWYgKHJlcG9Sb290ID09PSBudWxsKSByZXR1cm4gW107XG4gICAgY29uc3QgcmVsYXRpdmUgPSBkaWZmUmVsYXRpdmVCYXNlKGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0LCBlZmZlY3RpdmVEaXIsIHJlcG9Sb290KTtcbiAgICBpZiAocmVsYXRpdmUgPT09ICd1bnJlc29sdmFibGUnKSByZXR1cm4gW107XG4gICAgY29uc3QgYmFzZSA9IHJlbGF0aXZlICE9PSBudWxsID8gcmVsYXRpdmUuYmFzZSA6IHJlcG9Sb290O1xuICAgIGNvbnN0IHJvb3RzID0gcmVsYXRpdmUgIT09IG51bGwgPyBbcmVsYXRpdmUucm9vdF0gOiBbcmVwb1Jvb3RdO1xuICAgIHJldHVybiBjYXBTcGFucyhzcGFuc0ZvcihkZWNvZGVVbmlmaWVkRGlmZihzdGRvdXQpLCBiYXNlLCByb290cykpO1xuICB9XG5cbiAgY29uc3QgaW5mbyA9IGFuYWx5emVTZWFyY2hBcmd2KGdhdGVkLmFyZ3YsIGdhdGVkLnN0YXJ0KTtcblxuICAvLyBBIG5vbi1naXQgc2VhcmNoIGJpbiB3aXRoIG5vIHBhdGggYXJncyByZWFkcyBpdHMgcmVjb3JkcyBmcm9tIHdoYXRldmVyXG4gIC8vIHN0ZGluIGNhcnJpZXMgd2hlbiBpdCBpcyBwaXBlZCBvciByZWRpcmVjdGVkIGluIChgfGAsIGA8IGZpbGVgLFxuICAvLyBgPDw8YCwgYDwoXHUyMDI2KWApIFx1MjAxNCBsaW5lIG51bWJlcnMgYXJlIHRoZW4gc3RyZWFtIHBvc2l0aW9ucywgbm90IGZpbGVcbiAgLy8gbGluZXMsIGFuZCBkZWNvZGluZyB0aGVtIGZhYnJpY2F0ZXMgdG91Y2hlcyAoYSBzdGRpbiBsaW5lIFwiOVwiIGJlY29tZXMgYVxuICAvLyBwYXRoLCBhbmQgd2l0aCBhIHJlYWwgZmlsZSBuYW1lZCBgOWAgYXQgdGhlIGN3ZCB0aGUgcGhhbnRvbSBzdXJmYWNlcykuXG4gIC8vIGdhdGVkUmVkaXJlY3QgZXh0ZW5kcyB0aGUgcnVsZSB0byBhIHJlZGlyZWN0IEdMVUVEIGluc2lkZSBhIHRva2VuXG4gIC8vIChgcmcgbmVlZGxlPGNyYWZ0ZWQudHh0YCwgYSBjb25zdW1lZCBgLWVgL2AtZmAgdmFsdWUpOiBhcmd2IHNwbGl0dGluZ1xuICAvLyBuZXZlciBzdXJmYWNlcyBhIHN0YW5kYWxvbmUgYDxgIHRva2VuLCBzbyBvbmx5IHRoZSBxdW90ZS1hd2FyZSByYXctdGV4dFxuICAvLyBzY2FuIHNlZXMgaXQuIGdhdGVkSGVyZWRvYyBleHRlbmRzIGl0IHRvIGEgYDw8YC9gPDwtYCBIRVJFRE9DIGJvZHkgXHUyMDE0IHRoZVxuICAvLyBzcGxpdHRlciBzdHJpcHMgdGhlIG9wZXJhdG9yIGZyb20gdGhlIHRleHQsIHNvIG9ubHkgdGhlIHBlci1zdGFnZSBmbGFnXG4gIC8vIHNlZXMgdGhlIHJlZGlyZWN0LiBGYWlsIGNsb3NlZDogbm8gcmVzcG9uc2UtZGVyaXZlZCBzcGFucy4gRXhwbGljaXRcbiAgLy8gcGF0aCBhcmdzIHNjb3BlIHRoZSBzZWFyY2ggdG8gZmlsZXMgKHRoZSByZWRpcmVjdC9waXBlIGlzIHRoZW5cbiAgLy8gaXJyZWxldmFudCksIGFuZCBgZ2l0IGdyZXBgIG5ldmVyIHJlYWRzIHN0ZGluIFx1MjAxNCBib3RoIHN0YXkgb3Blbi5cbiAgY29uc3Qgc3RkaW5GZWQgPVxuICAgIGdhdGVkLmtpbmQgPT09ICdzZWFyY2gnICYmXG4gICAgZ2F0ZWQuYXJndlswXSAhPT0gJ2dpdCcgJiZcbiAgICBpbmZvLnBhdGhBcmdzLmxlbmd0aCA9PT0gMCAmJlxuICAgIChnYXRlZFByZWNlZGVkQnkgPT09ICdwaXBlJyB8fCBpbmZvLnN0ZGluUmVkaXJlY3QgfHwgZ2F0ZWRSZWRpcmVjdCB8fCBnYXRlZEhlcmVkb2MpO1xuICBpZiAoc3RkaW5GZWQpIHJldHVybiBbXTtcblxuICAvLyBnaXQgZ3JlcCBzY29waW5nOiBwbGFpbiBpbnZvY2F0aW9uIGZyb20gYSBzdWJkaXIgaXMgc2NvcGVkIHRvIHRoZSBzdWJkaXJcbiAgLy8gYnkgZ2l0IGl0c2VsZiAocmVjb3JkcyBhcmUgY3dkLXJlbGF0aXZlLCByb290IHN0YXlzIHRoZSBlZmZlY3RpdmUgZGlyKTtcbiAgLy8gcGF0aHNwZWMgbWFnaWMgKGA6L2AsIGA6IWAsIGA6XmAsIGA6KC4uLilgKSBzZWFyY2hlcyB0aGUgd2hvbGUgdHJlZSBhbmRcbiAgLy8gZW1pdHMgY3dkLXJlbGF0aXZlIHJlY29yZHMgd2l0aCBgLi4vYCBwcmVmaXhlcywgc28gdGhlIHBlcm1pdHRlZCByb290XG4gIC8vIHdpZGVucyB0byB0aGUgd29ya3RyZWUgcm9vdDsgYC0tZnVsbC1uYW1lYCByZS1hbmNob3JzIHJlY29yZHMgdG9cbiAgLy8gcmVwby1yb290LXJlbGF0aXZlIHBhdGhzLCB3aGljaCByZXNvbHZlcyBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290IHRvby5cbiAgY29uc3QgaXNHaXRHcmVwID0gZ2F0ZWQua2luZCA9PT0gJ3NlYXJjaCcgJiYgZ2F0ZWQuYXJndlswXSA9PT0gJ2dpdCc7XG4gIGNvbnN0IGZ1bGxOYW1lID0gaXNHaXRHcmVwICYmIGhhc0ZsYWcoZ2F0ZWQuYXJndiwgZ2F0ZWQuc3RhcnQsICctLWZ1bGwtbmFtZScpO1xuICBjb25zdCBtYWdpYyA9IGlzR2l0R3JlcCAmJiBpbmZvLnBhdGhzcGVjTWFnaWM7XG4gIGNvbnN0IHdvcmt0cmVlUm9vdCA9IG1hZ2ljIHx8IGZ1bGxOYW1lID8gZmluZEdpdFJvb3QoZWZmZWN0aXZlRGlyKSA6IG51bGw7XG4gIGlmICgobWFnaWMgfHwgZnVsbE5hbWUpICYmIHdvcmt0cmVlUm9vdCA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuXG4gIC8vIFdoZXJlIGRlY29kZWQgcmVjb3JkIHBhdGhzIHJlc29sdmUgZnJvbTogdGhlIGVmZmVjdGl2ZSBjd2QgZm9yIHBsYWluXG4gIC8vIGFuZCBtYWdpYyBnaXQgZ3JlcCAocmVjb3JkcyBhcmUgY3dkLXJlbGF0aXZlKSwgdGhlIHdvcmt0cmVlIHJvb3QgZm9yXG4gIC8vIGAtLWZ1bGwtbmFtZWAgKHJlY29yZHMgYXJlIHJlcG8tcm9vdC1yZWxhdGl2ZSkuXG4gIGNvbnN0IGJhc2UgPSBmdWxsTmFtZSAmJiB3b3JrdHJlZVJvb3QgIT09IG51bGwgPyB3b3JrdHJlZVJvb3QgOiBlZmZlY3RpdmVEaXI7XG5cbiAgLy8gUGVybWl0dGVkIHJvb3RzOiB0aGUgY29tbWFuZCdzIGV4cGxpY2l0IHNlYXJjaCByb290cywgb3IgdGhlIGVmZmVjdGl2ZVxuICAvLyBjd2Qgd2hlbiBubyBwYXRoIGFyZ3MgYXJlIGdpdmVuIChyZy9ncmVwIHNlYXJjaCBpdCBieSBkZWZhdWx0KSBcdTIwMTQgZXhjZXB0XG4gIC8vIGdpdCBncmVwIHdpdGggcGF0aHNwZWMgbWFnaWMsIHdoaWNoIHNlYXJjaGVzIHRoZSB3aG9sZSB0cmVlIGFuZCBtdXN0IGJlXG4gIC8vIHBlcm1pdHRlZCBhZ2FpbnN0IHRoZSB3b3JrdHJlZSByb290LlxuICBjb25zdCByb290cyA9XG4gICAgbWFnaWMgJiYgd29ya3RyZWVSb290ICE9PSBudWxsXG4gICAgICA/IFt3b3JrdHJlZVJvb3RdXG4gICAgICA6IGluZm8ucGF0aEFyZ3MubGVuZ3RoID4gMFxuICAgICAgICA/IGluZm8ucGF0aEFyZ3MubWFwKChwKSA9PiByZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIHApKVxuICAgICAgICA6IFtlZmZlY3RpdmVEaXJdO1xuXG4gIGNvbnN0IHNpbmdsZUZpbGVBcmcgPSBpbmZvLnBhdGhBcmdzLmxlbmd0aCA9PT0gMSA/IGluZm8ucGF0aEFyZ3NbMF0gOiBudWxsO1xuICAvLyBPbmUtZmlsZSBlbGlnaWJpbGl0eTogbnVtYmVyZWQgZXZpZGVuY2UsIGV4YWN0bHkgb25lIGV4cGxpY2l0IGZpbGVcbiAgLy8gYXJndW1lbnQgdGhhdCBpcyBhIHJlYWwgZmlsZSAoYSBkaXJlY3Rvcnkgb3Igbm8gYXJncyBtZWFucyByZWNvcmRzIGNhcnJ5XG4gIC8vIHBhdGggcHJlZml4ZXMpLCBhbmQgbm8gLUgvLS13aXRoLWZpbGVuYW1lICh3aGljaCBmb3JjZXMgcGF0aCBwcmVmaXhlcykuXG4gIGNvbnN0IG9uZUZpbGVFbGlnaWJsZSA9XG4gICAgaW5mby5udW1iZXJlZCAmJiAhaW5mby53aXRoRmlsZW5hbWUgJiYgc2luZ2xlRmlsZUFyZyAhPT0gbnVsbCAmJiBpc0ZpbGUocmVzb2x2ZVBhdGgoZWZmZWN0aXZlRGlyLCBzaW5nbGVGaWxlQXJnKSk7XG5cbiAgY29uc3QgbGF5b3V0ID0gZGV0ZWN0TGF5b3V0KHN0ZG91dCwgaW5mbywgb25lRmlsZUVsaWdpYmxlKTtcblxuICBjb25zdCBwZXJGaWxlID0gbmV3IE1hcDxzdHJpbmcsIFNldDxudW1iZXI+PigpO1xuICBpZiAobGF5b3V0ICE9PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCByZWMgb2YgZGVjb2RlU2VhcmNoTGF5b3V0KGxheW91dCwgc3Rkb3V0LCBzaW5nbGVGaWxlQXJnKSkge1xuICAgICAgLy8gRGVjb2RlZCBwYXRocyBtdXN0IGJlIHJlYWwgZmlsZXM6IGEgcmVjdXJzaXZlLWxheW91dCByZWNvcmQgd2hvc2VcbiAgICAgIC8vIHBhdGggaXMgbm90IGFuIGV4aXN0aW5nIHJlZ3VsYXIgZmlsZSAocmVzb2x2ZWQgYWdhaW5zdCB0aGUgcmVjb3JkXG4gICAgICAvLyBiYXNlIFx1MjAxNCB0aGUgZWZmZWN0aXZlIGN3ZCwgb3IgdGhlIHdvcmt0cmVlIHJvb3QgdW5kZXIgYC0tZnVsbC1uYW1lYClcbiAgICAgIC8vIGRyb3BzIGluc3RlYWQgb2YgZmFicmljYXRpbmcgYSB0b3VjaC5cbiAgICAgIGlmIChsYXlvdXQgPT09ICdyZWN1cnNpdmUnICYmICFpc0ZpbGUocmVzb2x2ZVBhdGgoYmFzZSwgcmVjLnBhdGgpKSkgY29udGludWU7XG4gICAgICBpZiAocmVjLmxpbmUgPT09IG51bGwpIHtcbiAgICAgICAgLy8gV2hvbGUtZmlsZSBudWxsLXNlcGFyYXRlZCByZWNvcmQ6IHRoZSB0ZXh0IGhvbGRzIHRoZSBlbnRpcmUgZmlsZS5cbiAgICAgICAgY29uc3QgdG90YWwgPSBsaW5lQ291bnQocmVjLnRleHQpO1xuICAgICAgICBsZXQgbGluZXMgPSBwZXJGaWxlLmdldChyZWMucGF0aCk7XG4gICAgICAgIGlmIChsaW5lcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGluZXMgPSBuZXcgU2V0KCk7XG4gICAgICAgICAgcGVyRmlsZS5zZXQocmVjLnBhdGgsIGxpbmVzKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGxldCBuID0gMTsgbiA8PSB0b3RhbDsgbisrKSBsaW5lcy5hZGQobik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsZXQgbGluZXMgPSBwZXJGaWxlLmdldChyZWMucGF0aCk7XG4gICAgICAgIGlmIChsaW5lcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbGluZXMgPSBuZXcgU2V0KCk7XG4gICAgICAgICAgcGVyRmlsZS5zZXQocmVjLnBhdGgsIGxpbmVzKTtcbiAgICAgICAgfVxuICAgICAgICBsaW5lcy5hZGQocmVjLmxpbmUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHNwYW5zID0gc3BhbnNGb3IocGVyRmlsZSwgYmFzZSwgcm9vdHMpO1xuXG4gIC8vIFdob2xlLWZpbGUgZmFsbGJhY2s6IG5vbi1lbXB0eSwgZnVsbHkgb2JzZXJ2ZWQgb3V0cHV0IChpdHMgdGVybWluYXRpbmdcbiAgLy8gbmV3bGluZSBpcyBwcmVzZW50KSB3aXRoIG5vIHBhcnNlYWJsZSBudW1iZXJlZCByZWNvcmQsIGFuIHVubnVtYmVyZWRcbiAgLy8gY29tbWFuZCAoYSBudW1iZXJlZCBjb21tYW5kIFx1MjAxNCBncmVwIC1uLCBubCwgY2F0IC1uIFx1MjAxNCB3aG9zZSBvdXRwdXRcbiAgLy8gY2FycmllcyBubyBwYXJzZWFibGUgcmVjb3JkIG11c3Qgbm90IGZhbGwgYmFjayBlaXRoZXI6IGl0cyByZWNvcmRzIGFyZVxuICAvLyBzdHJlYW0gcG9zaXRpb25zIG9yIGdhcmJhZ2UsIGFuZCB0aGUgd2hvbGUtZmlsZSBzcGFuIHdvdWxkIGZhYnJpY2F0ZSBhXG4gIC8vIHJlYWQgdGhlIHJlc3BvbnNlIG5ldmVyIGV2aWRlbmNlZCksIGFuZCBleGFjdGx5IG9uZSBleHBsaWNpdCBmaWxlXG4gIC8vIHJlc29sdmVzIHRvIGEgd2hvbGUtZmlsZSByZWFkIG9mIGl0LiBUaGUgdW5pdmVyc2FsIHRlcm1pbmF0aW5nLW5ld2xpbmVcbiAgLy8gcnVsZSBhcHBsaWVzIGhlcmUgdG9vOiBhIHN0cmVhbSBjdXQgYmVmb3JlIGFueSBjb21wbGV0ZSByZWNvcmQgaXMgbm90XG4gIC8vIGZ1bGx5IG9ic2VydmVkLCBzbyBhIHByZXZpZXcgb2YgYSBudW1iZXJlZCBvdXRwdXQgbXVzdCBub3QgYmUgbWlzdGFrZW5cbiAgLy8gZm9yIHVubnVtYmVyZWQgb3V0cHV0IGFuZCBtdXN0IG5vdCBpbnZlbnQgYSB3aG9sZS1maWxlIHRvdWNoLiBUaGUgZmlsZVxuICAvLyBtdXN0IGJlIGEgcmVhZGFibGUgZmlsZSAoYSBkaXJlY3RvcnkgYXJnIGxlYXZlcyB0aGUgZmFsbGJhY2tcbiAgLy8gdW5yZXNvbHZlZCksIGFuZCBpdCBtdXN0IHNpdCBpbnNpZGUgdGhlIGRlY2xhcmVkIHJvb3RzIFx1MjAxNCBpdCBpcyBvbmUgb2ZcbiAgLy8gdGhlbSBieSBjb25zdHJ1Y3Rpb24uXG4gIGlmIChwZXJGaWxlLnNpemUgPT09IDAgJiYgIWluZm8ubnVtYmVyZWQgJiYgc3Rkb3V0ICE9PSAnJyAmJiBzdGRvdXQuZW5kc1dpdGgoJ1xcbicpICYmIHNpbmdsZUZpbGVBcmcgIT09IG51bGwpIHtcbiAgICBjb25zdCBhYnMgPSByZXNvbHZlUGF0aChlZmZlY3RpdmVEaXIsIHNpbmdsZUZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsID0gY291bnRGaWxlTGluZXMoYWJzKTtcbiAgICBpZiAodG90YWwgIT09IG51bGwgJiYgdG90YWwgPiAwKSB7XG4gICAgICBzcGFucy5wdXNoKHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiB0b3RhbCwgYWJzb2x1dGVQYXRoOiBhYnMgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNhcFNwYW5zKHNwYW5zKTtcbn1cbiIsICIvKipcbiAqIENvZGV4IGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgcGFyc2VyLlxuICpcbiAqIFR1cm5zIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBgdG9vbF9pbnB1dC5jb21tYW5kYCBwYXRjaCBzdHJpbmcgaW50byB0aGVcbiAqIGBBbmNob3JTcGVjW11gIHNoYXBlIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBhbHJlYWR5IGNvbnN1bWVzIFx1MjAxNCB0aGUgb25lXG4gKiBnZW51aW5lbHkgbmV3IGFsZ29yaXRobSB0aGUgQ29kZXggYWRhcHRlciBuZWVkcy4gSXQgcmVwbGFjZXMgdGhlIHN0cnVjdHVyZWRcbiAqIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYC9gb2Zmc2V0YCByZWFkaW5nIHRoZSBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9va1xuICogZG9lcywgYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlXG4gKiByYXRoZXIgdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIHRvdWNoIHRyYWNraW5nXG4gKiBtdXN0IG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIEFuIGFuY2hvciBwYXJzZWQgZnJvbSBhbiBhcHBseV9wYXRjaCBlbnZlbG9wZTogYW4ge0BsaW5rIEFuY2hvclNwZWN9IHBsdXNcbiAqIHRoZSBkZWxldGUgY2xhc3NpZmljYXRpb24gKHBsYW4gXHUwMEE3MykuIGAqKiogRGVsZXRlIEZpbGU6YCBodW5rcyBrZWVwIHRoZVxuICogYHdob2xlLXdyaXRlYCBraW5kIChUb3VjaEtpbmQgaXMgZml4ZWQpIGFuZCBhZGQgdGhlIGBhYnNlbnRgIG1hcmtlciBzbyB0aGVcbiAqIGFwcGx5X3BhdGNoIGNhbGwgc2l0ZSBwYXNzZXMgYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMDE0IHdpdGhvdXQgaXQgdGhlXG4gKiBkZWxldGlvbiB0b3VjaCB3b3VsZCBiZSBnYXRlZCBhd2F5IGJ5IHRoZSBgJ2V4aXN0cydgIGRlZmF1bHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQYXRjaEFuY2hvciBleHRlbmRzIEFuY2hvclNwZWMge1xuICAvKiogdHJ1ZSBmb3IgYCoqKiBEZWxldGUgRmlsZTpgIGh1bmtzIFx1MjAxNCB0aGUgdG91Y2gncyB0YXJnZXRTdGF0ZSBpcyBgJ2Fic2VudCdgLiAqL1xuICBhYnNlbnQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgd2l0aCB0aGUgYGFic2VudGAgbWFya2VyICh3aG9sZS1maWxlO1xuICogICB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzIFx1MjAxNCB0aGUgdG91Y2ggdGFyZ2V0cyBhYnNlbmNlLCBwbGFuIFx1MDBBNzMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBcHBseVBhdGNoQW5jaG9yW10ge1xuICBjb25zdCBhbmNob3JzOiBBcHBseVBhdGNoQW5jaG9yW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJywgYWJzZW50OiB0cnVlIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgImltcG9ydCBob29rIGZyb20gXCIuL3Bvc3QtdG9vbC11c2UudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBb0NBLFNBQVMsV0FBV0Esb0JBQW1COzs7QUNSaEMsSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUlPLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUztBQUM3QyxTQUFPLGVBQWUsZUFBZSxRQUFRLE9BQU87QUFDeEQ7OztBQ2ZBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFDbEIsWUFB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UyxXQUFXO0FBQUEsVUFDeEMsR0FBSSxPQUFPLFNBQVMsRUFBRSxXQUFXLEVBQUUsWUFBWSxLQUFLLEVBQUUsSUFBSSxDQUFDO0FBQUEsUUFDN0Q7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQSxVQUFJLE9BQU8sa0JBQW1CLFFBQU8sS0FBSyxPQUFPLGlCQUFpQjtBQUFBLElBQ3BFO0FBRUEsUUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFVBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixXQUFPLGtCQUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxzQ0FBc0MsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QWtCM2JsSCxRQUFRLHFCQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlUGF0aCIsICJyZXNvbHZlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImpvaW4iLCAiZXhlY0ZpbGVTeW5jIiwgImpvaW4iLCAibGluZUNvdW50IiwgImJhc2VuYW1lIiwgImpvaW4iLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgImlzQWJzb2x1dGUiLCAiZXhlY0ZpbGVTeW5jIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJpIiwgImpvaW4iLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAicmVhZEZpbGVTeW5jIiwgImlzQWJzb2x1dGUiLCAidG9rZW5zIiwgImV4aXN0c1N5bmMiLCAic3RhdFN5bmMiLCAiZGlybmFtZSIsICJqb2luIiwgInJlc29sdmVQYXRoIiwgImhhc1NoZWxsRXhwYW5zaW9uIiwgImZpbmRHaXRTdWJjb21tYW5kIiwgImV4aXN0c1N5bmMiLCAicmVzb2x2ZVBhdGgiLCAic2VwIiwgInN0YXRTeW5jIiwgImpvaW4iLCAiZGlybmFtZSIsICJIVU5LX0hFQURFUiIsICJiYXNlIiwgInJvb3RzIiwgImZzIiwgInRvUG9zaXgiLCAiY3R4IiwgInJlY292ZXJSYW5nZSIsICJjb21tYW5kIiwgInJlc29sdmVQYXRoIiwgImJsb2NrcyIsICJjb21iaW5lZCJdCn0K
