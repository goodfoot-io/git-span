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
function createRealityProbeCache(paths) {
  return { paths: [...new Set(paths)], realPaths: null };
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
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    }
  }
  const probeCache = createRealityProbeCache(probePaths);
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
      else if (current.path === "/dev/null") current.path = path;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgLCBvciBhIHRyYW5zbGF0ZWQgQmFzaCB3cml0ZSBzcGFuKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHBvc3QtZWRpdCByYW5nZSB3aGVuIHN0YXRpY2FsbHkga25vd24gKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcyxcbiAgICogcGF0Y2ggaHVuayB1bmlvbnMpOyBieXBhc3NlcyB7QGxpbmsgcmVjb3ZlclJhbmdlRnJvbURpc2t9IChwbGFuIFx1MDBBNzNcbiAgICogc3RlcCAzKS5cbiAgICovXG4gIHJhbmdlPzogTGluZVJhbmdlO1xuICAvKipcbiAgICogVGhlIGZpbGUncyBleHBlY3RlZCBwb3N0LWNvbW1hbmQgc3RhdGU7IHRoZSB3cml0ZSBwYXRoIGdhdGVzIG9uIGl0IGJlZm9yZVxuICAgKiBpbnZva2luZyBhbnkgZXhlY3V0b3IgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLiBBYnNlbnQgbWVhbnMgYCdleGlzdHMnYCBcdTIwMTQgdGhlXG4gICAqIEVkaXQvV3JpdGUgYW5kIGFwcGx5X3BhdGNoIHBhdGhzJyBkZWZhdWx0LlxuICAgKi9cbiAgdGFyZ2V0U3RhdGU/OiAnZXhpc3RzJyB8ICdhYnNlbnQnO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQsIHZlcmlmaWVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAgICogY2FsbCAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBgY29udGVudGAgY29tcGFyZXMgdGhlIG9uLWRpc2sgc3RhdGUgYWZ0ZXIgdGhlXG4gICAqIGNvbW1hbmQgcmFuOyBgcmVhbERlbGV0ZWAgaXMgZGVsZXRlLW9ubHkgXHUyMDE0IHRoZSBwYXRoIG11c3QgYWxzbyBiZVxuICAgKiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLlxuICAgKi9cbiAgcG9zdFN0YXRlPzoge1xuICAgIC8qKiBgZXhhY3RgOiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YDogZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YDogemVybyBieXRlczsgYHNpemVgOiBieXRlIGNvdW50LiAqL1xuICAgIGNvbnRlbnQ/OiBUb3VjaFBvc3RDb250ZW50O1xuICAgIC8qKiBkZWxldGUtb25seTogdGhlIHBhdGggbXVzdCBhbHNvIGJlIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCAocHJvYmVzIGNhY2hlZCBwZXIgY29tbWFuZCkuICovXG4gICAgcmVhbERlbGV0ZT86IGJvb2xlYW47XG4gIH07XG4gIC8qKlxuICAgKiBjcC9pbnN0YWxsIGRlc3RpbmF0aW9uLXZzLXNvdXJjZSB2ZXJpZmljYXRpb24gKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYVxuICAgKiBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlXG4gICAqIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocmVhbCArIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXJcbiAgICogc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyBcdTIwMTQgdGhlIGRyaXZlcidzIHBhc3MtQSBob2xkKS4gU2V0IGJ5IHRoZVxuICAgKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgY3AgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBuZXZlciBzZXRcbiAgICogYnkgYWRhcHRlcnMuIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZCBcdTIwMTRcbiAgICogc3RyaXBwZWQgb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICogZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogbXYvZ2l0IG12L3BhdGNoIHJlbmFtZSBzb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IHRoZVxuICAgKiBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIFx1MjAxNFxuICAgKiBhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzXG4gICAqIG5ldmVyIHRvdWNoZWQuIE5vIGNvbnRlbnQgY29tcGFyaXNvbiAocGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQpLlxuICAgKiBTZXQgYnkgdGhlIGBydW5CYXNoVG91Y2hlc2AgZHJpdmVyIG9uIHBhaXJlZCByZW5hbWUtY29weSB0b3VjaGVzLlxuICAgKi9cbiAgcmVuYW1lU291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vKipcbiAqIEEgc3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYGV4YWN0YCBcdTIwMTRcbiAqIGZpbGUgYnl0ZXMgZXF1YWw7IGBzdWZmaXhgIFx1MjAxNCBmaWxlIGNvbnRlbnQgZW5kcyB3aXRoIGl0OyBgZW1wdHlgIFx1MjAxNCB6ZXJvXG4gKiBieXRlczsgYHNpemVgIFx1MjAxNCBieXRlIGNvdW50LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFBvc3RDb250ZW50ID0geyBleGFjdDogc3RyaW5nIH0gfCB7IHN1ZmZpeDogc3RyaW5nIH0gfCB7IGVtcHR5OiB0cnVlIH0gfCB7IHNpemU6IG51bWJlciB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3Qtc3RhdGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX06IGEgZGVjaXNpdmUgcGFzcy9mYWlsIGNhcnJpZXNcbiAqIHZlcmRpY3Qgd2VpZ2h0IChjb250ZW50IHZlcmlmaWVkLCBvciBhYnNlbmNlICsgZGVsZXRlLXJlYWxpdHkgdmVyaWZpZWQpO1xuICogYCdpbmNvbmNsdXNpdmUnYCBpcyBldmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgKHNlZCAtaSxcbiAqIHBhdGNoL2dpdCBhcHBseSwgZm9ybWF0dGVycywgcmVzdG9yZS9jaGVja291dCkgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nLCBhbmQgcHJvYmUtaW5hcHBsaWNhYmxlIGNhc2VzIChwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWRcbiAqIGRlbGV0ZXMsIGRpcmVjdG9yeSB0YXJnZXRzKS4gYCdwZW5kaW5nJ2AgaXMgdGhlIGRyaXZlcidzIGFic2VudC1zb3VyY2UgaG9sZFxuICogKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhbiBhYnNlbnQgY3Agc291cmNlIHRoYXQgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIGNhbm5vdFxuICogZGVjaWRlIGl0cyBkZXN0aW5hdGlvbiB1bnRpbCB0aGUgcGFzcy1BIGV4cGxhbmF0aW9uIG1hcCBpcyBjb21wbGV0ZS5cbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGVHYXRlT3V0Y29tZSA9ICdkZWNpc2l2ZVBhc3MnIHwgJ2RlY2lzaXZlRmFpbCcgfCAnaW5jb25jbHVzaXZlJyB8ICdwZW5kaW5nJztcblxuLyoqXG4gKiBQZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eSBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiBvbmUgYGdpdFxuICogbHMtZmlsZXMgLS1lcnJvci11bm1hdGNoYCBhbmQgb25lIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCBiYXRjaCBwZXJcbiAqIGNvbW1hbmQsIG5ldmVyIG9uZSBwZXIgcGF0aCwgbWVtYmVyc2hpcCBmcm9tIHByaW50ZWQgcm93cy4gVGhlXG4gKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBzZWVkcyBpdCB3aXRoIGV2ZXJ5IGFic2VudCB0YXJnZXQgYW5kIGNwL2luc3RhbGxcbiAqIHNvdXJjZSBvZiB0aGUgY29tcG91bmQgYW5kIHNoYXJlcyBpdCBpbnRvIHBhc3MgQiBzbyBzdXJ2aXZpbmcgZGVsZXRlc1xuICogcmUtZ2F0ZSB3aXRob3V0IHJlLXByb2JpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVhbGl0eVByb2JlQ2FjaGUge1xuICAvKiogRGlzdGluY3QgYWJzb2x1dGUgcGF0aHMgdG8gcHJvYmUsIGluIGZpcnN0LXNlZW4gb3JkZXIuICovXG4gIHBhdGhzOiBzdHJpbmdbXTtcbiAgLyoqIExhenk6IGFic29sdXRlIHBhdGhzIGNvbmZpcm1lZCBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQsIGNvbXB1dGVkIG9uY2UuICovXG4gIHJlYWxQYXRoczogU2V0PHN0cmluZz4gfCBudWxsO1xufVxuXG4vKiogQ3JlYXRlIGEgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgZm9yIHRoZSBnaXZlbiBhYnNvbHV0ZSBwYXRocy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwYXRoczogSXRlcmFibGU8c3RyaW5nPik6IFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgcmV0dXJuIHsgcGF0aHM6IFsuLi5uZXcgU2V0KHBhdGhzKV0sIHJlYWxQYXRoczogbnVsbCB9O1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBleGlzdHMgb24gZGlzayAoYW55IG5vZGUga2luZCk7IGBmYWxzZWAgb24gYW55IHN0YXQgZmFpbHVyZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxlRXhpc3RzKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGZzLnN0YXRTeW5jKGFic1BhdGgpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYSByZWd1bGFyIGZpbGUgXHUyMDE0IGEgZGlyZWN0b3J5IHRhcmdldCBmYWlscyB0aGUgYCdleGlzdHMnYCBnYXRlLiAqL1xuZnVuY3Rpb24gaXNGaWxlT25EaXNrKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhhYnNQYXRoKS5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVmVyaWZ5IGEgc3RhdGljYWxseSBrbm93YWJsZSBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gYWdhaW5zdCB0aGUgb24tZGlza1xuICogZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBBbnkgcmVhZCBmYWlsdXJlIGlzIGEgbWlzbWF0Y2gsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiBjb250ZW50TWF0Y2hlcyhwb3N0OiBUb3VjaFBvc3RDb250ZW50LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgaWYgKCdleGFjdCcgaW4gcG9zdCkgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKSA9PT0gcG9zdC5leGFjdDtcbiAgICBpZiAoJ3N1ZmZpeCcgaW4gcG9zdCkge1xuICAgICAgLy8gVGhlIHNoZWxsIGFwcGVuZHMgdGhlIGJvZHkgcGx1cyBpdHMgdGVybWluYXRpbmcgbmV3bGluZTsgdGhlIGhlcmVkb2NcbiAgICAgIC8vIGdyYW1tYXIgc3RyaXBzIGV4YWN0bHkgdGhhdCBvbmUgYFxcbmAgZnJvbSBgc3Bhbi53cml0dGVuYFxuICAgICAgLy8gKHBhcnNlLWNvbW1hbmQudHMgaGVyZWRvYyBib2R5IGV4dHJhY3Rpb24pLCBzbyBhIGZpbGUgZW5kaW5nXG4gICAgICAvLyBgd3JpdHRlblxcbmAgaXMgdGhlIHNhbWUgYXBwZW5kZWQgdGV4dCBhcyBgd3JpdHRlbmAgXHUyMDE0IGFjY2VwdCBib3RoLlxuICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgIHJldHVybiBjb250ZW50LmVuZHNXaXRoKHBvc3Quc3VmZml4KSB8fCBjb250ZW50LmVuZHNXaXRoKGAke3Bvc3Quc3VmZml4fVxcbmApO1xuICAgIH1cbiAgICBpZiAoJ2VtcHR5JyBpbiBwb3N0KSByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IDA7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSBwb3N0LnNpemU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiBsYXppbHkgcnVuIHRoZSB0d28gcGVyLWNvbW1hbmRcbiAqIGJhdGNoZXMgYW5kIGNhY2hlIHRoZSBjb25maXJtZWQtcmVhbCBwYXRoIHNldC4gTWVtYmVyc2hpcCBjb21lcyBmcm9tIHRoZVxuICogcHJpbnRlZCByb3dzLCBub3QgdGhlIGV4aXQgY29kZSBcdTIwMTQgYGdpdCBscy1maWxlcyAtLWVycm9yLXVubWF0Y2hgIHByaW50c1xuICogZXZlcnkgdHJhY2tlZCBwYXRoIGV2ZW4gd2hlbiBpdCBleGl0cyBub256ZXJvIChhbnkgbWlzc2luZyBwYXRoKSwgYW5kXG4gKiBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgcHJpbnRzIG5vdGhpbmcgZm9yIHBoYW50b20gb3Iga25vd24tYnV0LVxuICogdW5zcGFubmVkIHBhdGhzIChleGl0IDAgd2l0aCBcIk5vIHNwYW5zIG1hdGNoIHRoZSBmaWx0ZXJzXCIpLiBBIHBsYWluLWBybWAnZFxuICogdHJhY2tlZCBmaWxlIGtlZXBzIGl0cyBpbmRleCBlbnRyeSAobHMtZmlsZXMgZXhpdCAwIFx1MjAxNCB0aGUgcHJvYmUgZmlyZXMpO1xuICogYGdpdCBybWAgcmVtb3ZlcyBpdCAobHMtZmlsZXMgMTI4KSBzbyBvbmx5IHNwYW5uZWQgZmlsZXMgc3RheSByZWFsLiBBXG4gKiBwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWQgcGF0aCBmYWlscyBib3RoIHByb2JlcyBcdTIwMTQgdGhlIGRlbGV0ZSBkZWdyYWRlc1xuICogdG8gYCdpbmNvbmNsdXNpdmUnYCBhbmQgbmV2ZXIgZmlyZXMuIEZhaWwtc2FmZTogYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3IgYVxuICogcHJvYmUgZmFpbHVyZSB5aWVsZHMgYW4gZW1wdHkgc2V0LCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVhbFBhdGhzKGNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gIGlmIChjYWNoZS5yZWFsUGF0aHMgIT09IG51bGwpIHJldHVybiBjYWNoZS5yZWFsUGF0aHM7XG4gIGNvbnN0IHJlYWwgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgaWYgKGNhY2hlLnBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGlmIChyZXBvUm9vdCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVscyA9IGNhY2hlLnBhdGhzLm1hcCgocCkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIHApKTtcbiAgICAgIGNvbnN0IGNhcHR1cmUgPSAoYXJnczogc3RyaW5nW10pOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgICAgICAgIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zdCBzdGRvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiBudWxsO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY29uc3QgbHNGaWxlcyA9IGNhcHR1cmUoWydscy1maWxlcycsICctLWVycm9yLXVubWF0Y2gnLCAnLS0nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAobHNGaWxlcyAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbHNGaWxlcy5zcGxpdCgnXFxuJykpIHtcbiAgICAgICAgICBjb25zdCByZWwgPSBsaW5lLnRyaW0oKTtcbiAgICAgICAgICBpZiAocmVsLmxlbmd0aCA+IDApIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJlbCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBzcGFuTGlzdCA9IGNhcHR1cmUoWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAoc3Bhbkxpc3QgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgcGFyc2VQb3JjZWxhaW4oc3Bhbkxpc3QpKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByb3cucGF0aCkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBjYWNoZS5yZWFsUGF0aHMgPSByZWFsO1xuICByZXR1cm4gcmVhbDtcbn1cblxuLyoqXG4gKiBUaGUgbGF5ZXJlZCBwb3N0LXN0YXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLCBldmFsdWF0ZWQgYmVmb3JlIGFueSBleGVjdXRvclxuICogY2FsbCwgc2lkZS1lZmZlY3QtZnJlZSAobm8gbWVtbyB3cml0ZXMsIG5vIGV4ZWN1dG9yIGNhbGxzOyB0aGUgcHJvYmUgaXNcbiAqIHJlYWQtb25seSBhbmQgcGVyLWNvbW1hbmQgY2FjaGVkKTpcbiAqXG4gKiAxLiBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIxOTIgdGhlIHBhdGggbXVzdCBiZSBhYnNlbnQ7IHdoZW4gaXQgaXMsIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgZGVjaWRlczogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIFx1MjE5MiBgZGVjaXNpdmVQYXNzYFxuICogICAgKGRhbmdsaW5nIGFuY2hvcnMgc3VyZmFjZSksIHBoYW50b20gXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AgKG5vdGhpbmcgdG9cbiAqICAgIHN1cmZhY2UgXHUyMDE0IHRoZSBtaXNzIGlzIGhhcm1sZXNzLCBhbmQgdGhlIGRlbGV0ZSBuZXZlciBmaXJlcykuXG4gKiAyLiBgdGFyZ2V0U3RhdGU6ICdleGlzdHMnYCBcdTIxOTIgdGhlIHRhcmdldCBtdXN0IGJlIGEgcmVndWxhciBmaWxlIChhIGRpcmVjdG9yeVxuICogICAgb3IgbWlzc2luZyB0YXJnZXQgZmFpbHMpLlxuICogMy4gQ29udGVudCB2ZXJpZmljYXRpb24gd2hlcmUgdGhlIGV4cGVjdGVkIHBvc3QtY29udGVudCBpcyBzdGF0aWNhbGx5XG4gKiAgICBrbm93YWJsZSAoYGV4YWN0YC9gc3VmZml4YC9gZW1wdHlgL2BzaXplYCk6IGEgbWlzbWF0Y2ggbWVhbnMgdGhlIHdyaXRlJ3NcbiAqICAgIGVmZmVjdCBpcyBhYnNlbnQgXHUyMDE0IG5vIHRvdWNoLlxuICogNC4gY3AgZGVzdGluYXRpb24tdnMtc291cmNlOiBhIHN0aWxsLXByZXNlbnQgc291cmNlIG11c3QgYnl0ZS1lcXVhbCB0aGVcbiAqICAgIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGFzc2VkIHRoZVxuICogICAgcmVhbGl0eSBwcm9iZSBBTkQgaXRzIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoXG4gKiAgICBgZGVjaXNpdmVQYXNzYCBcdTIwMTQgdGhlIGRyaXZlciByZXNvbHZlcyB0aGUgYCdwZW5kaW5nJ2AgaG9sZCkuXG4gKiA1LiByZW5hbWUtY29weTogdGhlIGRlc3RpbmF0aW9uIGZpcmVzIG9ubHkgd2hlbiBpdHMgc291cmNlIHBhc3NlZCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCkuXG4gKlxuICogRXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZyBcdTIwMTQgaXMgYCdpbmNvbmNsdXNpdmUnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0OiBUb3VjaFdyaXRlSW5wdXQsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmIChpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2luY29uY2x1c2l2ZSc7XG4gIH1cblxuICBpZiAoIWlzRmlsZU9uRGlzayhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcblxuICBjb25zdCBjb250ZW50ID0gaW5wdXQucG9zdFN0YXRlPy5jb250ZW50O1xuICBpZiAoY29udGVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGNvbnRlbnRNYXRjaGVzKGNvbnRlbnQsIGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQuc291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuc291cmNlUGF0aCkpIHtcbiAgICAgIGxldCBzcmM6IHN0cmluZztcbiAgICAgIGxldCBkc3Q6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIHNyYyA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5zb3VyY2VQYXRoLCAndXRmOCcpO1xuICAgICAgICBkc3QgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNyYyA9PT0gZHN0ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgLy8gQWJzZW50IHNvdXJjZSBcdTIwMTQgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpOiB0aGUgZGVzdFxuICAgIC8vIGZpcmVzIG9ubHkgd2hlbiB0aGUgc291cmNlIHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSAoaXQgd2FzIGEgcmVhbFxuICAgIC8vIGZpbGUpIEFORCBpdHMgYWJzZW5jZSBpcyBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuc291cmNlUGF0aCkgPyAncGVuZGluZycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5yZW5hbWVTb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBObyBjb250ZW50IGNvbXBhcmlzb24gXHUyMDE0IHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50OyBhIHBoYW50b21cbiAgICAvLyBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkIGFuZCBhIHByZS1leGlzdGluZyBkZXN0aW5hdGlvbiB3YXMgbmV2ZXJcbiAgICAvLyB0b3VjaGVkIChwbGFuIFx1MDBBNzMgc3RlcCAxYykuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5yZW5hbWVTb3VyY2VQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCByZW1vdmUgaXRzIG9sZCBhbmNob3IgYmVmb3JlIGFkZGluZyB0aGUgbmV3IG9uZS4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX0gKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHJ1bnMgZmlyc3QgXHUyMDE0XG4gKiAgIGFueSBkZWNpc2l2ZSBmYWlsLCBvciBhbiBpbmNvbmNsdXNpdmUgcGhhbnRvbSBkZWxldGUsIGJsb2NrcyB0aGUgdG91Y2hcbiAqICAgd2l0aCBubyBleGVjdXRvciBjYWxsIFx1MjAxNCB0aGVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPlxuICogICAtLWZpeGApIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmdcbiAqICAgdHJlZSwgYW5kIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGlzIGNvbXB1dGVkIGFnYWluc3QgdGhlIGhlYWxlZFxuICogICBhbmNob3JzLCByZW5kZXJpbmcgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoXG4gKiAgIGFueSByZW1haW5pbmcgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzXG4gKiAgIGRlZHVwZWQgdGhyb3VnaCBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIFRoZSBvcHRpb25hbCBgcHJvYmVDYWNoZWAgc2hhcmVzIHRoZSBkcml2ZXIncyBwZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eVxuICogcHJvYmUgaW50byBwYXNzIEIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dFxuICogcmUtcHJvYmluZzsgZGlyZWN0IGNhbGxlcnMgZ2V0IGEgcGVyLWNhbGwgY2FjaGUgc2VlZGVkIHdpdGggdGhlIHRvdWNoZWRcbiAqIHBhdGggd2hlbiB0aGUgdGFyZ2V0IGlzIGAnYWJzZW50J2AuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcHJvYmVDYWNoZT86IFJlYWxpdHlQcm9iZUNhY2hlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgcHJvYmUgPSBwcm9iZUNhY2hlID8/IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JyA/IFtpbnB1dC5maWxlUGF0aF0gOiBbXSk7XG4gICAgICBjb25zdCBvdXRjb21lID0gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQsIHByb2JlKTtcbiAgICAgIGlmIChvdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyB8fCAob3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSkge1xuICAgICAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gaW5wdXQucmFuZ2UgPz8gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZywgYW5kXG4gICAgICAgIC8vIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgQmFzaCBzcGFuIFx1MjE5MiB0b3VjaCB0cmFuc2xhdGlvbiBhbmQgdGhlIGpvaW4tZ2F0aW5nIGRyaXZlciAocGxhbiBcdTAwQTcyLFxuICogXHUwMEE3MyBzdGVwIDIpLiBCb3RoIGFkYXB0ZXJzIGNvbnN1bWUgdGhpcyBtb2R1bGUgb25jZSB0aGVpciBkdXBsaWNhdGUgQmFzaFxuICogc3BhbiBsb29wcyBjb2xsYXBzZTogaXQgb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0IHBhc3MgQVxuICogYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCwgdGhlIGV4cGxhbmF0aW9uIG1hcCwgdGhlIGpvaW4gZmlsdGVyLCBhbmQgcGFzcyBCXG4gKiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmQgYGludGVycnVwdGVkYFxuICogZ2F0ZSAocGxhbiBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiwgU3Bhbk1hdGNoIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHR5cGUgTWVtb1N0b3JlLCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlLFxuICBldmFsdWF0ZVdyaXRlR2F0ZSxcbiAgZmlsZUV4aXN0cyxcbiAgdHlwZSBSZWFsaXR5UHJvYmVDYWNoZSxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXQsXG4gIHR5cGUgV3JpdGVHYXRlT3V0Y29tZVxufSBmcm9tICcuL3RvdWNoLWNvcmUuanMnO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgcmVzb2x2ZWQgc3BhbiBpbnRvIGEgZnVsbHktdHlwZWQge0BsaW5rIFRvdWNoSW5wdXR9IHBlciB0aGVcbiAqIHBsYW4gXHUwMEE3MiB0YWJsZSwgb3IgYG51bGxgIHdoZW4gdGhlIHBhdGggZmFpbHMgYHJlc29sdmVUb3VjaFNjb3BlYCBcdTIwMTQgY3Jvc3MtXG4gKiByZXBvLCBnaXRpZ25vcmVkLCBhbmQgc3Bhbi1kb2N1bWVudCBwYXRocyBmYWlsIGNsb3NlZC5cbiAqXG4gKiBUaGUgcG9zdC1zdGF0ZSBnYXRlIGZpZWxkcyB0aGUgc3BhbiBjYW4gZGV0ZXJtaW5lIChgdGFyZ2V0U3RhdGVgLCBhbmRcbiAqIGBwb3N0U3RhdGVgIGZvciBhcHBlbmRzIGFuZCBkZWxldGVzKSBhcmUgc2V0IGhlcmU7IGEgbGl0ZXJhbCBvdmVyd3JpdGUgYm9keVxuICogKGBzcGFuLndyaXR0ZW5gIFx1MjAxNCB0aGUgZmxhZy1sZXNzIGBlY2hvYC9gcHJpbnRmYCBgPmAgY2FzZSkgcmlkZXMgYXMgdGhlXG4gKiBgZXhhY3RgIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3RcbiAqIHdoaWxlIHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBUcnVuY2F0ZXMgbWFwXG4gKiB0aGUgc3BhbidzIHN0YXRpY2FsbHkgZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCB0byB0aGUgYHNpemVgIHBvc3QtY29udGVudFxuICogKGAtcyAwYCBcdTIxOTIgYGVtcHR5YCk7IGEgdHJ1bmNhdGUgd2l0aG91dCBhIHNpemUgZ2F0ZXMgZXhpc3RlbmNlLW9ubHkuIFRoZVxuICogZHJpdmVyIHBhaXJzIGNwL2luc3RhbGwgYW5kIG12IHNvdXJjZXMgb250byB0aGUgZGVzdGluYXRpb24gdG91Y2hlc1xuICogYWZ0ZXJ3YXJkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFNwYW5Ub1RvdWNoKHNwYW46IFJlc29sdmVkU3Bhbiwgc2Vzc2lvbklkOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogVG91Y2hJbnB1dCB8IG51bGwge1xuICBpZiAoIXJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpKSByZXR1cm4gbnVsbDtcbiAgc3dpdGNoIChzcGFuLm9wZXJhdGlvbikge1xuICAgIGNhc2UgJ3JlYWQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICBvZmZzZXQ6IHNwYW4ubGluZVN0YXJ0LFxuICAgICAgICBsaW1pdDpcbiAgICAgICAgICBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkICYmIHNwYW4ubGluZUVuZCAhPT0gdW5kZWZpbmVkID8gc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2NyZWF0ZS1vdmVyd3JpdGUnOlxuICAgIGNhc2UgJ3JlbmFtZS1jb3B5JzpcbiAgICAgIC8vIFdob2xlLWZpbGUgd3JpdGVzOiBgd3JpdHRlbjogJydgIHNjb3BlcyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmdcbiAgICAgIC8vIHNwYW4gXHUyMDE0IHRydW5jYXRpbmcgd3JpdGVzIGRlc3Ryb3kgYW5jaG9ycyBiZXlvbmQgdGhlIG5ldyBFT0YgKHRoZVxuICAgICAgLy8gbWFpbi0yMDAgRjIgbGVzc29uKS4gQSBsaXRlcmFsIGJvZHkgcmlkZXMgYXMgdGhlIGV4YWN0IHBvc3QtY29udGVudFxuICAgICAgLy8gZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBleGFjdDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICd0cnVuY2F0ZSc6XG4gICAgICAvLyBTYW1lIHdob2xlLWZpbGUgc2NvcGU7IHRoZSBzaXplIGdhdGUgKHBsYW4gXHUwMEE3MiwgXHUwMEE3MyBzdGVwIDFiKSB2ZXJpZmllc1xuICAgICAgLy8gdGhlIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IHdoZW4gdGhlIHNwYW4gY2FycmllcyBhIHN0YXRpY2FsbHlcbiAgICAgIC8vIGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgKGAtcyAwYCBcdTIxOTIgZW1wdHkpOyB3aXRob3V0IG9uZSB0aGUgZ2F0ZSBpc1xuICAgICAgLy8gZXhpc3RlbmNlLW9ubHkuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6XG4gICAgICAgICAgc3Bhbi5zaXplID09PSAwXG4gICAgICAgICAgICA/IHsgY29udGVudDogeyBlbXB0eTogdHJ1ZSB9IH1cbiAgICAgICAgICAgIDogc3Bhbi5zaXplICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgc2l6ZTogc3Bhbi5zaXplIH0gfVxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdhcHBlbmQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogc3Bhbi53cml0dGVuID8/ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgc3VmZml4OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ21vZGlmeSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICByYW5nZTogc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgc3RhcnQ6IHNwYW4ubGluZVN0YXJ0LCBlbmQ6IHNwYW4ubGluZUVuZCA/PyBzcGFuLmxpbmVTdGFydCB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnLFxuICAgICAgICBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9XG4gICAgICB9O1xuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgQmFzaCBgdG9vbF9yZXNwb25zZWAgc2lnbmFscyB0aGF0IHRoZSBjb21tYW5kIHdhcyBpbnRlcnJ1cHRlZFxuICogKHBsYW4gXHUwMEE3NCkuIFRoZSBTREsgdHlwZXMgdGhlIHJlc3BvbnNlIGB1bmtub3duYCBvbiBib3RoIGFkYXB0ZXJzLCBzbyB0aGlzXG4gKiBpcyBhIGRlZmVuc2l2ZSBydW50aW1lIHNoYXBlLXByb2JlOiBhbiBvYmplY3QgY2FycnlpbmcgYSB0cnV0aHlcbiAqIGBpbnRlcnJ1cHRlZGAgZmllbGQgY2xhc3NpZmllcyBhcyBpbnRlcnJ1cHRlZDsgYW55IG90aGVyIHNoYXBlIChzdHJpbmcsXG4gKiBudWxsLCBvYmplY3Qgd2l0aG91dCB0aGUgZmllbGQpIHByb2NlZWRzIGZhaWwtb3BlbiwgbWF0Y2hpbmcgdG9kYXknc1xuICogYmVoYXZpb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBib29sZWFuIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBCb29sZWFuKCh0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmludGVycnVwdGVkKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogVGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgJ3MgcHJvY2VzcyBleGl0IGNvZGUsIHdoZW4gdGhlIGhhcm5lc3Mgc3VwcGxpZXNcbiAqIG9uZS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMgYW5kIENsYXVkZSdzXG4gKiBCYXNoIGVudmVsb3BlcyBkbyBub3QgY3VycmVudGx5IGNhcnJ5IGFuIGBleGl0X2NvZGVgIGZpZWxkLCBzbyB0aGlzIGlzIGFcbiAqIGRlZmVuc2l2ZSBzaGFwZS1wcm9iZSB3aXRoIHRoZSBwbGFuIFx1MDBBNzQgZmFpbC1vcGVuIHBvc3R1cmU6IHByZXNlbnQgXHUyMTkyIHRoZVxuICogaW50ZWdlciBjb2RlLCBhYnNlbnQgb3IgYW55IG90aGVyIHNoYXBlIFx1MjE5MiB1bmRlZmluZWQsIGFuZCB0aGUgY2FsbGVyXG4gKiBwcm9jZWVkcyBleGFjdGx5IGFzIHRvZGF5LiAoVGhlIGhvb2sgc3VicHJvY2VzcydzIG93biBleGl0IHN0YXR1cyBcdTIwMTQgdGhlXG4gKiBTREsncyBgU0RLSG9va1Jlc3BvbnNlTWVzc2FnZS5leGl0X2NvZGVgIFx1MjAxNCBpcyBhIGRpZmZlcmVudCBjaGFubmVsIGFuZCBpc1xuICogbmV2ZXIgcmVhZCBoZXJlLilcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCBjb2RlID0gKHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZXhpdF9jb2RlO1xuICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzSW50ZWdlcihjb2RlKSkgcmV0dXJuIGNvZGU7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGVyLWNvbW1hbmQgdmVyZGljdCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBSZXNvbHZlZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAncmVzb2x2ZWQnIH0+O1xudHlwZSBHdWFyZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCcgfT47XG5cbnR5cGUgVmVyZGljdCA9ICdmYWlsZWQnIHwgJ3N1Y2NlZWRlZCcgfCAndW5rbm93bic7XG5cbi8qKiBPbmUgcGFzcy1BIGV2YWx1YXRpb246IHRoZSBzcGFuLCBpdHMgdG91Y2gsIGFuZCB0aGUgKHBvc3QtcmVzb2x1dGlvbikgZ2F0ZSBvdXRjb21lLiAqL1xuaW50ZXJmYWNlIFNwYW5FdmFsIHtcbiAgbWF0Y2g6IFJlc29sdmVkTWF0Y2g7XG4gIC8qKiBUaGUgdHJhbnNsYXRlZCB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlIHNwYW4gZmFpbGVkIGByZXNvbHZlVG91Y2hTY29wZWAuICovXG4gIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbDtcbiAgLyoqIFRoZSBwYXNzLUEgZ2F0ZSBvdXRjb21lLCBwb3N0LXJlc29sdXRpb24gZm9yIGAncGVuZGluZydgIGFuZCBleHBsYWluZWQgZmFpbHMuICovXG4gIG91dGNvbWU6IFdyaXRlR2F0ZU91dGNvbWU7XG4gIC8qKiBBIGRlY2lzaXZlRmFpbCBkb3duZ3JhZGVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyAocGxhbiBcdTAwQTczIHN0ZXAgMikuICovXG4gIGV4cGxhaW5lZDogYm9vbGVhbjtcbiAgY29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKiBUaGUgc3BhbidzIG93biBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBkZWNpc2l2ZSBmYWlscy4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogY3AgZGVzdGluYXRpb25zOiB0aGUgcGFpcmVkIHNvdXJjZSBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBwZW5kaW5ncy4gKi9cbiAgc291cmNlS2V5OiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIG9uZSBzcGFuJ3MgZ2F0ZS4gUmVhZHMgaGF2ZSBubyBnYXRlIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgLCB3aXRoIG9uZVxuICogZXhjZXB0aW9uOiBjcC9pbnN0YWxsIHNvdXJjZSByZWFkcyBnYXRlIG9uIHRoZSBzb3VyY2UgZXhpc3RpbmcgcG9zdC1jb21tYW5kXG4gKiAocGxhbiBcdTAwQTcyKSBcdTIwMTQgYSBmYWlsZWQgY29weSBuZXZlciByZWFkIGFueXRoaW5nLiBUaGUgcmVhZCB2ZXJkaWN0IGZsaXBzIG9ubHlcbiAqIHRoZSBjb21tYW5kJ3Mgam9pbiB2ZXJkaWN0LCBuZXZlciB0aGUgc2FtZSBjb21tYW5kJ3MgZGVzdCB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZXZhbFNwYW5HYXRlKG1hdGNoOiBSZXNvbHZlZE1hdGNoLCB0b3VjaDogVG91Y2hJbnB1dCB8IG51bGwsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmICh0b3VjaCA9PT0gbnVsbCkgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xuICBpZiAodG91Y2gua2luZCA9PT0gJ3JlYWQnKSB7XG4gICAgaWYgKChtYXRjaC5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtYXRjaC5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtYXRjaC5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICByZXR1cm4gZmlsZUV4aXN0cyhtYXRjaC5zcGFuLmFic29sdXRlUGF0aCkgPyAnaW5jb25jbHVzaXZlJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgIH1cbiAgICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIH1cbiAgcmV0dXJuIGV2YWx1YXRlV3JpdGVHYXRlKHRvdWNoLCBwcm9iZUNhY2hlKTtcbn1cblxuLyoqIFRoZSBvcGVyYXRvciBwcmVjZWRpbmcgYSBjb21tYW5kLCBmcm9tIGl0cyBmaXJzdCBzcGFuIChhbGwgc3BhbnMgb2Ygb25lIGNvbW1hbmQgc2hhcmUgaXQpIFx1MjAxNCBvciBmcm9tIGl0cyBndWFyZCBtYXRjaCB3aGVuIHRoZSBjb21tYW5kIGhhcyBubyBzcGFucy4gKi9cbmZ1bmN0aW9uIGpvaW5PZkNvbW1hbmQoXG4gIGlkeDogbnVtYmVyLFxuICBncm91cHM6IE1hcDxudW1iZXIsIFJlc29sdmVkTWF0Y2hbXT4sXG4gIGd1YXJkQnlJbmRleDogTWFwPG51bWJlciwgR3VhcmRNYXRjaD5cbik6ICcmJicgfCAnfHwnIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc3BhbnMgPSBncm91cHMuZ2V0KGlkeCk7XG4gIGlmIChzcGFucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBpZiAobS5zcGFuLmpvaW4gIT09IHVuZGVmaW5lZCkgcmV0dXJuIG0uc3Bhbi5qb2luO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBndWFyZEJ5SW5kZXguZ2V0KGlkeCk/LmpvaW47XG59XG5cbi8qKlxuICogU2hhcmVkIEJhc2ggZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0XG4gKiBwYXNzIEEgYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCAoZXZlcnkgc3BhbiwgYmVmb3JlIGFueSBqb2luIGRlY2lzaW9uKSxcbiAqIHRoZSBleHBsYW5hdGlvbiBtYXAsIHBlci1jb21tYW5kIHZlcmRpY3RzLCB0aGUgam9pbiBmaWx0ZXIgd2l0aCBjaGFpbmVkXG4gKiBza2lwcywgYW5kIHBhc3MgQiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmRcbiAqIGBpbnRlcnJ1cHRlZGAgYW5kIGV4aXQtY29kZSBnYXRlcyAocGxhbiBcdTAwQTc0KSBhbmQgdGhlIHNwYW4tbGVzcy1ndWFyZFxuICogY29tbWFuZHMgKGBmYWxzZWAvYHRydWVgL2A6YCBqb2luIHZlcmRpY3RzIHdpdGggbm8gc3BhbnMgb2YgdGhlaXIgb3duKS5cbiAqIFJldHVybnMgdGhlIG5vbi1udWxsIGBhZGRpdGlvbmFsQ29udGV4dGAgYmxvY2tzIGZvciB0aGUgYWRhcHRlciB0byBqb2luO1xuICogdGhlIHNlc3Npb24gbWVtbyBkZWR1cHMgcmVwZWF0ZWQgdGFyZ2V0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkJhc2hUb3VjaGVzKFxuICBtYXRjaGVzOiBTcGFuTWF0Y2hbXSxcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIGN3ZDogc3RyaW5nLFxuICB0b29sUmVzcG9uc2U6IHVua25vd24sXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgd2FybjogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCA9IGNvbnNvbGUud2FyblxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAvLyBBIGNvbW1hbmQgdGhhdCBkaWQgbm90IGNvbXBsZXRlIHByb2R1Y2VzIG5vIHRvdWNoZXMsIHdoYXRldmVyIGl0cyBzcGFucy5cbiAgaWYgKGJhc2hSZXNwb25zZUludGVycnVwdGVkKHRvb2xSZXNwb25zZSkpIHJldHVybiBbXTtcbiAgY29uc3QgZXhpdENvZGUgPSBiYXNoUmVzcG9uc2VFeGl0Q29kZSh0b29sUmVzcG9uc2UpO1xuICBjb25zdCByZXNvbHZlZCA9IG1hdGNoZXMuZmlsdGVyKChtKTogbSBpcyBSZXNvbHZlZE1hdGNoID0+IG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKTtcbiAgY29uc3QgZ3VhcmRzID0gbWF0Y2hlcy5maWx0ZXIoKG0pOiBtIGlzIEd1YXJkTWF0Y2ggPT4gbS5zdGF0dXMgPT09ICdidWlsdGluLWd1YXJkJyk7XG4gIGlmIChyZXNvbHZlZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICAvLyBTZWVkIHRoZSBwZXItY29tbWFuZCBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpIHdpdGggZXZlcnkgYWJzZW50XG4gIC8vIHRhcmdldCBhbmQgY3AvaW5zdGFsbCBzb3VyY2Ugb2YgdGhlIGNvbXBvdW5kOyB0aGUgZmlyc3QgZ2F0ZSB0aGF0IG5lZWRzXG4gIC8vIGl0IHJ1bnMgb25lIGxzLWZpbGVzICsgb25lIHNwYW4tbGlzdCBiYXRjaCBmb3IgYWxsIG9mIHRoZW0uXG4gIGNvbnN0IHByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGVsc2UgaWYgKChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHByb2JlQ2FjaGUgPSBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwcm9iZVBhdGhzKTtcblxuICAvLyBHcm91cCBieSBzaW1wbGUgY29tbWFuZCBpbiB3YWxrZXIgb3JkZXIuIFNwYW4tbGVzcyBndWFyZCBjb21tYW5kc1xuICAvLyAoYGZhbHNlYC9gdHJ1ZWAvYDpgKSBqb2luIHRoZSBvcmRlciB3aXRoIG5vIGdyb3VwOiB0aGVpciBkZXRlcm1pbmlzdGljXG4gIC8vIGV4aXQgc3RhdHVzIGRyaXZlcyB0aGUgam9pbiBmaWx0ZXIsIGFuZCB0aGV5IG5ldmVyIHRvdWNoIGFueXRoaW5nLlxuICBjb25zdCBncm91cHMgPSBuZXcgTWFwPG51bWJlciwgUmVzb2x2ZWRNYXRjaFtdPigpO1xuICBjb25zdCBndWFyZEJ5SW5kZXggPSBuZXcgTWFwPG51bWJlciwgR3VhcmRNYXRjaD4oKTtcbiAgY29uc3QgY29tbWFuZE9yZGVyOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBjb25zdCBpZHggPSBtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4O1xuICAgIGNvbnN0IGxpc3QgPSBncm91cHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGlzdC5wdXNoKG0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cHMuc2V0KGlkeCwgW21dKTtcbiAgICAgIGNvbW1hbmRPcmRlci5wdXNoKGlkeCk7XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgZyBvZiBndWFyZHMpIHtcbiAgICBpZiAoZ3JvdXBzLmhhcyhnLnNpbXBsZUNvbW1hbmRJbmRleCkgfHwgZ3VhcmRCeUluZGV4LmhhcyhnLnNpbXBsZUNvbW1hbmRJbmRleCkpIGNvbnRpbnVlO1xuICAgIGd1YXJkQnlJbmRleC5zZXQoZy5zaW1wbGVDb21tYW5kSW5kZXgsIGcpO1xuICAgIGNvbW1hbmRPcmRlci5wdXNoKGcuc2ltcGxlQ29tbWFuZEluZGV4KTtcbiAgfVxuICBjb21tYW5kT3JkZXIuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuXG4gIC8vIFBhc3MgQTogdHJhbnNsYXRlIGV2ZXJ5IHNwYW4gb25jZSBhbmQgZXZhbHVhdGUgaXRzIGdhdGUsIHBhaXJpbmdcbiAgLy8gY3AvaW5zdGFsbCBzb3VyY2VzIHdpdGggZGVzdGluYXRpb25zIGFuZCBtdiBkZWxldGVzIHdpdGggcmVuYW1lLWNvcGllcyBieVxuICAvLyBkZWNsYXJhdGlvbiBvcmRlciAodGhlIHBhcnNlciBlbWl0cyBzb3VyY2VzIGJlZm9yZSBkZXN0aW5hdGlvbnMpLlxuICBjb25zdCBldmFscyA9IG5ldyBNYXA8bnVtYmVyLCBTcGFuRXZhbFtdPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgICBpZiAoc3BhbnMgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGd1YXJkLW9ubHkgY29tbWFuZCBcdTIwMTQgbm90aGluZyB0byBldmFsdWF0ZVxuICAgIGNvbnN0IHJlYWRQYXRocyA9IHNwYW5zXG4gICAgICAuZmlsdGVyKChtKSA9PiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJylcbiAgICAgIC5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGNvbnN0IGRlbGV0ZVBhdGhzID0gc3BhbnMuZmlsdGVyKChtKSA9PiBtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykubWFwKChtKSA9PiBtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBsZXQgcmVhZEN1cnNvciA9IDA7XG4gICAgbGV0IGRlbGV0ZUN1cnNvciA9IDA7XG4gICAgY29uc3QgbGlzdDogU3BhbkV2YWxbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgbSBvZiBzcGFucykge1xuICAgICAgY29uc3QgdG91Y2ggPSBiYXNoU3BhblRvVG91Y2gobS5zcGFuLCBzZXNzaW9uSWQsIGN3ZCk7XG4gICAgICBjb25zdCBlbnRyeTogU3BhbkV2YWwgPSB7XG4gICAgICAgIG1hdGNoOiBtLFxuICAgICAgICB0b3VjaCxcbiAgICAgICAgb3V0Y29tZTogJ2luY29uY2x1c2l2ZScsXG4gICAgICAgIGV4cGxhaW5lZDogZmFsc2UsXG4gICAgICAgIGNvbW1hbmRJbmRleDogaWR4LFxuICAgICAgICBwYXRoOiBtLnNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICBzb3VyY2VLZXk6IG51bGxcbiAgICAgIH07XG4gICAgICBpZiAodG91Y2ggIT09IG51bGwgJiYgdG91Y2gua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgICBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2NyZWF0ZS1vdmVyd3JpdGUnICYmIChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykpIHtcbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSByZWFkUGF0aHNbcmVhZEN1cnNvcl07XG4gICAgICAgICAgaWYgKHNvdXJjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZWFkQ3Vyc29yICs9IDE7XG4gICAgICAgICAgICAvLyBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQ6IHN0cmlwcGVkXG4gICAgICAgICAgICAvLyBvdXRwdXQgbmV2ZXIgZXF1YWxzIHRoZSBzb3VyY2UsIHNvIGluc3RhbGwgZGVzdHMgZ2F0ZVxuICAgICAgICAgICAgLy8gZXhpc3RlbmNlLW9ubHkgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS5cbiAgICAgICAgICAgIGlmIChtLmlkaW9tID09PSAnY3Atd3JpdGUnKSB7XG4gICAgICAgICAgICAgIHRvdWNoLnNvdXJjZVBhdGggPSBzb3VyY2U7XG4gICAgICAgICAgICAgIGVudHJ5LnNvdXJjZUtleSA9IHNvdXJjZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlbmFtZS1jb3B5Jykge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IGRlbGV0ZVBhdGhzW2RlbGV0ZUN1cnNvcl07XG4gICAgICAgICAgaWYgKHNvdXJjZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGVDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIHRvdWNoLnJlbmFtZVNvdXJjZVBhdGggPSBzb3VyY2U7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBlbnRyeS5vdXRjb21lID0gZXZhbFNwYW5HYXRlKG0sIHRvdWNoLCBwcm9iZUNhY2hlKTtcbiAgICAgIGxpc3QucHVzaChlbnRyeSk7XG4gICAgfVxuICAgIGV2YWxzLnNldChpZHgsIGxpc3QpO1xuICB9XG5cbiAgLy8gVGhlIGV4cGxhbmF0aW9uIG1hcCAocGxhbiBcdTAwQTczIHN0ZXAgMik6IHRoZSBoaWdoZXN0IHNpbXBsZUNvbW1hbmRJbmRleCB3aXRoXG4gIC8vIGEgZGVjaXNpdmVQYXNzIG9uIGVhY2ggcGF0aC5cbiAgY29uc3QgcGFzc0J5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHtcbiAgICAgICAgY29uc3QgcHJldiA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQgfHwgaWR4ID4gcHJldikgcGFzc0J5UGF0aC5zZXQoZS5wYXRoLCBpZHgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJlc29sdmUgdGhlIGFic2VudC1zb3VyY2UgaG9sZHMgYWdhaW5zdCB0aGUgbm93LWNvbXBsZXRlIG1hcCwgYW5kXG4gIC8vIGRvd25ncmFkZSBleHBsYWluZWQgZmFpbHM6IGEgZGVjaXNpdmVGYWlsIG9uIGEgcGF0aCBhIGxhdGVyIGNvbW1hbmRcbiAgLy8gZGVtb25zdHJhYmx5IHJld3JvdGUgb3IgZGVsZXRlZCBpcyB0aGUgb3ZlcndyaXRlLCBub3QgdGhlIGVhcmxpZXIgY29tbWFuZFxuICAvLyBmYWlsaW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAncGVuZGluZycpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IGUuc291cmNlS2V5ICE9PSBudWxsID8gcGFzc0J5UGF0aC5nZXQoZS5zb3VyY2VLZXkpIDogdW5kZWZpbmVkO1xuICAgICAgICBlLm91dGNvbWUgPSBwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH0gZWxzZSBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXgpIGUuZXhwbGFpbmVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBQZXItY29tbWFuZCB2ZXJkaWN0czogJ2ZhaWxlZCcgb24gYW55IHVuZXhwbGFpbmVkIGRlY2lzaXZlRmFpbCwgZWxzZVxuICAvLyAnc3VjY2VlZGVkJyBvbiBhdCBsZWFzdCBvbmUgZGVjaXNpdmUgb3V0Y29tZSwgZWxzZSAndW5rbm93bicuIEFcbiAgLy8gZ3VhcmQtb25seSBjb21tYW5kJ3MgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBJUyBpdHMgdmVyZGljdCAocGxhbiBcdTAwQTczXG4gIC8vIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZCBydWxlKS5cbiAgY29uc3QgY29tcHV0ZWQgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGd1YXJkID0gZ3VhcmRCeUluZGV4LmdldChpZHgpO1xuICAgICAgY29tcHV0ZWQuc2V0KGlkeCwgZ3VhcmQgIT09IHVuZGVmaW5lZCA/IChndWFyZC5leGl0U3RhdHVzID09PSAwID8gJ3N1Y2NlZWRlZCcgOiAnZmFpbGVkJykgOiAndW5rbm93bicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGxldCBmYWlsZWQgPSBmYWxzZTtcbiAgICBsZXQgcGFzc2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnICYmICFlLmV4cGxhaW5lZCkgZmFpbGVkID0gdHJ1ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSBwYXNzZWQgPSB0cnVlO1xuICAgIH1cbiAgICBjb21wdXRlZC5zZXQoaWR4LCBmYWlsZWQgPyAnZmFpbGVkJyA6IHBhc3NlZCA/ICdzdWNjZWVkZWQnIDogJ3Vua25vd24nKTtcbiAgfVxuXG4gIC8vIFRoZSBqb2luIGZpbHRlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGEgc2tpcHBlZCBjb21tYW5kJ3MgY2hhaW5lZCB2ZXJkaWN0IGlzXG4gIC8vIHRoZSBndWFyZCB0aGF0IHNraXBwZWQgaXQgXHUyMDE0ICdmYWlsZWQnIGFmdGVyIGFuICYmLXNraXAsICdzdWNjZWVkZWQnIGFmdGVyXG4gIC8vIGFuIHx8LXNraXAgXHUyMDE0IG1hdGNoaW5nIHRoZSBzaGVsbCBzaG9ydC1jaXJjdWl0IChhIHx8IGIgfHwgYyBzdG9wcyBhZnRlclxuICAvLyB0aGUgZmlyc3Qgc3VjY2VzcykuICd1bmtub3duJyBmYWlscyBvcGVuLlxuICBjb25zdCBlZmZlY3RpdmUgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgY29uc3Qgc2tpcHBlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICBsZXQgcHJldkluZGV4OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgam9pbiA9IGpvaW5PZkNvbW1hbmQoaWR4LCBncm91cHMsIGd1YXJkQnlJbmRleCk7XG4gICAgY29uc3QgcHJldlZlcmRpY3QgPSBwcmV2SW5kZXggIT09IG51bGwgPyBlZmZlY3RpdmUuZ2V0KHByZXZJbmRleCkgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHByZXZWZXJkaWN0ICE9PSB1bmRlZmluZWQgJiYgam9pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoKGpvaW4gPT09ICcmJicgJiYgcHJldlZlcmRpY3QgPT09ICdmYWlsZWQnKSB8fCAoam9pbiA9PT0gJ3x8JyAmJiBwcmV2VmVyZGljdCA9PT0gJ3N1Y2NlZWRlZCcpKSB7XG4gICAgICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBqb2luID09PSAnJiYnID8gJ2ZhaWxlZCcgOiAnc3VjY2VlZGVkJyk7XG4gICAgICAgIHNraXBwZWQuYWRkKGlkeCk7XG4gICAgICAgIHByZXZJbmRleCA9IGlkeDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBjb21wdXRlZC5nZXQoaWR4KSEpO1xuICAgIHByZXZJbmRleCA9IGlkeDtcbiAgfVxuXG4gIC8vIFBhc3MgQjogcnVuIHRoZSB0b3VjaCBob29rIGZvciBzdXJ2aXZpbmcgc3BhbnMgb25seSBcdTIwMTQgZGVjaXNpdmVQYXNzLCBvclxuICAvLyBpbmNvbmNsdXNpdmUgd2l0aCBhbiAnZXhpc3RzJyB0YXJnZXQgKHRoZSBhZHZpc29yeSByZXNpZHVhbCBjbGFzczpcbiAgLy8gZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIGZpcmUgYW5kIGhlYWwvc3VyZmFjZTsgcGhhbnRvbSBkZWxldGVzIG5ldmVyXG4gIC8vIGZpcmUpLiBBIGhhcm5lc3Mtc3VwcGxpZWQgbm9uLXplcm8gZXhpdCBjb2RlIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5XG4gIC8vIGNsYXNzIHRvbyBcdTIwMTQgdGhlIGNvbW1hbmQgZmFpbGVkLCBzbyB0aGUgZXhpc3RlbmNlLWdhdGVkIHdyaXRlIChzZWQgLWksXG4gIC8vIHBhdGNoLCBnaXQgYXBwbHksIGZvcm1hdHRlcikgZGVtb25zdHJhYmx5IGRpZCBub3QgaGFwcGVuOyBhIHplcm8gb3JcbiAgLy8gYWJzZW50IGNvZGUgcHJvY2VlZHMsIGFuZCBjb250ZW50LXZlcmlmaWVkIGRlY2lzaXZlIHBhc3NlcyBmaXJlXG4gIC8vIHJlZ2FyZGxlc3MgKGZhaWwtb3BlbiwgcGxhbiBcdTAwQTc0KS4gR3VhcmQtb25seSBjb21tYW5kcyBoYXZlIG5vIHRvdWNoZXMuXG4gIC8vIEV4cGxhaW5lZCBmYWlscyBhbmQgZGVjaXNpdmUgZmFpbHMgbmV2ZXIgcmVhY2ggYW4gZXhlY3V0b3IuXG4gIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgaWYgKHNraXBwZWQuaGFzKGlkeCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBsZXQgdG91Y2hlcyA9IDA7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUuZXhwbGFpbmVkKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGUudG91Y2gua2luZCA9PT0gJ3dyaXRlJyAmJiBlLnRvdWNoLnRhcmdldFN0YXRlID09PSAnYWJzZW50JykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZXhpdENvZGUgIT09IHVuZGVmaW5lZCAmJiBleGl0Q29kZSAhPT0gMClcbiAgICAgICAgY29udGludWU7XG4gICAgICBpZiAodG91Y2hlcyA+PSAzMikge1xuICAgICAgICAvLyBIYXJkIHBlci1jb21tYW5kIHZvbHVtZSBjYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBkcm9wIHRoZSBzdXJwbHVzIHdpdGhcbiAgICAgICAgLy8gYSB3YXJuaW5nIHJhdGhlciB0aGFuIGJsb3cgdGhlIGhvb2sgdGltZW91dCBvbiBhIDUwLWNvcHkgY2hhaW4uXG4gICAgICAgIHdhcm4oYEJhc2ggdG91Y2ggY2FwICgzMikgcmVhY2hlZCBmb3Igc2ltcGxlIGNvbW1hbmQgJHtpZHh9OyBkcm9wcGluZyB0aGUgcmVtYWluaW5nIHRvdWNoZXNgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0b3VjaGVzICs9IDE7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soZS50b3VjaCwgZXhlY3V0b3JzLCBtZW1vLCBwcm9iZUNhY2hlKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBibG9ja3M7XG59XG4iLCAiLyoqXG4gKiBTdGF0aWMgY2xhc3NpZmljYXRpb24gb2YgYSBCYXNoIHRvb2wgYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlXG4gKiBwYXRoKHMpICsgbGluZSByYW5nZShzKSBpdCByZWFkcyBvciB3cml0ZXMsIHdoZXJlIHRoYXQncyBzdGF0aWNhbGx5XG4gKiBkZXRlcm1pbmFibGUuIEJ1aWx0IGZyb20gYW4gZW1waXJpY2FsIHBhc3Mgb3ZlciB+MzFrIHJlYWwgQ2xhdWRlIENvZGVcbiAqIEJhc2ggaW52b2NhdGlvbnMgKHNlZSBhbmFseXplLXRyYW5zY3JpcHRzLm10cykgXHUyMDE0IHRoZSBpZGlvbXMgYmVsb3cgYXJlXG4gKiBleGFjdGx5IHRoZSBvbmVzIHRoYXQgdHVybmVkIG91dCB0byBiZSBjb21tb24gQU5EIHJlbGlhYmxlIHRoZXJlLlxuICpcbiAqIERlbGliZXJhdGVseSBOT1QgY292ZXJlZCAoc2VlIHRoZSByZXNlYXJjaCByZXBvcnQpOiBhd2sgTlItdHJpY2tzIChyYXJlLFxuICogdW5jb25zdHJhaW5lZCBzeW50YXgpLCBncmVwIC1uLy1BLy1CLy1DICh0aGUgd2luZG93IGlzIGFuY2hvcmVkIHRvIG1hdGNoXG4gKiBwb3NpdGlvbiwgd2hpY2ggaXMgZGF0YS1kZXBlbmRlbnQsIG5vdCBpbiB0aGUgY29tbWFuZCB0ZXh0KSwgZW1iZWRkZWRcbiAqIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50IGxhbmd1YWdlJ3MgQVNULCBub3QgYSBzaGVsbFxuICogY29uY2VybiksIGFuZCBgZmluZCA8ZGlyPiAtbmFtZS8tcGF0aCAuLi4gLWRlbGV0ZWAgKHRoZSBkZWxldGVkIHBhdGhzIGFyZVxuICogdGhlIGRpcmVjdG9yeSdzIGNvbnRlbnRzIGFzIHRoZSBmaW5kZXIgd2Fsa3MgaXQgXHUyMDE0IGRhdGEtZGVwZW5kZW50LCBub3RcbiAqIHN0YXRpY2FsbHkgZW51bWVyYWJsZTsgdGhlIHJlY3Vyc2l2ZS1yZW1vdmFsIGZhaWwtY2xvc2VkIHJ1bGUgYXBwbGllcykuXG4gKlxuICogVGhlIGNhcmQncyB3cml0ZS10b3VjaCBmYW1pbGllcyBcdTIwMTQgcmVkaXJlY3Rpb25zIGFuZCBoZXJlZG9jcyAoXHUwMEE3NS4xXHUyMDEzXHUwMEE3NS4yKSxcbiAqIGNwIGFuZCBpbnN0YWxsIChcdTAwQTc1LjMpLCBtdiBhbmQgZ2l0IG12IChcdTAwQTc1LjQpLCBybSBhbmQgdHJ1bmNhdGUgKFx1MDBBNzUuNSksXG4gKiBzZWQgLWkgKFx1MDBBNzUuNiksIHBhdGNoIGFuZCBnaXQgYXBwbHkgKFx1MDBBNzUuNyksIGZvcm1hdHRlciB3cml0ZSBmbGFncyAoXHUwMEE3NS44KSxcbiAqIGFuZCBnaXQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlY3MgKFx1MDBBNzUuOSkgXHUyMDE0IGFyZSB0aGUgZ3JhbW1hcnMgYmVsb3cuIEVhY2hcbiAqIGZhbWlseSBmYWlscyBjbG9zZWQgb24gd2hhdCBpdCBjYW5ub3Qgc3RhdGljYWxseSBhdHRyaWJ1dGU6XG4gKiBzaGVsbC1leHBhbmRlZCBvciBkeW5hbWljIGNvbnRlbnQsIHJlY3Vyc2l2ZSByZW1vdmFsIChgcm0gLXJgKSxcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApLCBkaXJlY3Rvcnktc2hhcGVkIHRhcmdldHMsIHdyYXBwZXItd3JhcHBlZCBjb21tYW5kc1xuICogd2hvc2UgYXJndiBjYW5ub3QgYmUgcmVjb3ZlcmVkLCBhbmQgdW5tYXRjaGVkIHBhdGhzcGVjcyBlbWl0IG5vIHNwYW4gYXRcbiAqIGFsbCBvciBhbiBleHBsaWNpdCB1bnJlc29sdmVkIGVudHJ5IFx1MjAxNCBuZXZlciBhIGd1ZXNzZWQgd3JpdGUuXG4gKi9cbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luIGFzIGpvaW5QYXRoLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IHR5cGUgU2ltcGxlQ29tbWFuZCwgc3BsaXRUb3BMZXZlbCwgc3RyaXBMZWFkaW5nQXNzaWdubWVudHMsIHR5cGUgVG9rZW4sIHRva2VuaXplIH0gZnJvbSAnLi9zaGVsbC1zcGxpdC5qcyc7XG5pbXBvcnQgeyB0eXBlIFBhdGhTdHJpcCwgcGFyc2VVbmlmaWVkRGlmZlJhbmdlIH0gZnJvbSAnLi91bmlmaWVkLWRpZmYuanMnO1xuXG4vKipcbiAqIFRoZSBleHBsaWNpdCBvcGVyYXRpb24ga2luZCBvZiBhIHJlc29sdmVkIHNwYW4uIFRoZSBhZGFwdGVycyB0cmFuc2xhdGUgZnJvbVxuICogdGhpcywgbmV2ZXIgZnJvbSBgaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJ2Atc3R5bGUgY2hlY2tzIChwbGFuIFx1MDBBNzEpLlxuICovXG5leHBvcnQgdHlwZSBPcGVyYXRpb24gPVxuICB8ICdyZWFkJyAvLyByZWFkIGlkaW9tczsgY3AvaW5zdGFsbCBzb3VyY2Ugb3BlcmFuZHNcbiAgfCAnY3JlYXRlLW92ZXJ3cml0ZScgLy8gdHJ1bmNhdGluZyBjb250ZW50IHdyaXRlczogPiByZWRpcmVjdHMsIHRlZSwgaGVyZWRvYyA+LCBjcC9tdiBkZXN0LCByZXN0b3JlL2NoZWNrb3V0LCBwYXRjaCBhZGRcbiAgfCAnYXBwZW5kJyAvLyA+PiByZWRpcmVjdHMsIHRlZSAtYSwgaGVyZWRvYyA+PlxuICB8ICdtb2RpZnknIC8vIGluLXBsYWNlIGVkaXRzIHdpdGggdW5rbm93biBjb250ZW50OiBzZWQgLWksIHBhdGNoIGh1bmtzLCBmb3JtYXR0ZXIgd3JpdGUgZmxhZ3NcbiAgfCAncmVuYW1lLWNvcHknIC8vIG12L2dpdCBtdi9wYXRjaC1yZW5hbWUgZGVzdGluYXRpb24gKHdob2xlLWZpbGUgd3JpdGUsIHNhbWUgdG91Y2ggYXMgY3JlYXRlLW92ZXJ3cml0ZSlcbiAgfCAndHJ1bmNhdGUnIC8vIDogPiBmLCBiYXJlID4gZiwgdHJ1bmNhdGVcbiAgfCAnZGVsZXRlJzsgLy8gcm0sIG12L2dpdCBtdiBzb3VyY2UsIHBhdGNoIGRlbGV0ZVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIG9wZXJhdGlvbjogT3BlcmF0aW9uO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHJhbmdlOiBldmVyeSByZWFkOyBtb2RpZnkgb3BlcmF0aW9ucyB3aXRoIGEgc3RhdGljYWxseSBrbm93biByYW5nZVxuICAgKiAoc2VkIC1pIG51bWVyaWMgYWRkcmVzc2VzLCBwYXRjaCBodW5rIHVuaW9ucykuIEFic2VudCBmb3Igd3JpdGVzIFx1MjE5MlxuICAgKiB3aG9sZS1maWxlIHNjb3BlLlxuICAgKi9cbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93biB3cml0dGVuIGNvbnRlbnQgXHUyMDE0IGFwcGVuZCBib2RpZXMgYW5kIGxpdGVyYWwgb3ZlcndyaXRlXG4gICAqIGJvZGllcyAoaGVyZWRvYy9lY2hvL3ByaW50Zi90ZWUgbGl0ZXJhbHMsIHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gT24gYXBwZW5kcyBpdFxuICAgKiBpcyB0aGUgc3VmZml4IGdhdGUncyBib2R5OyBvbiBgY3JlYXRlLW92ZXJ3cml0ZWAgaXQgaXMgdGhlIGV4YWN0IGdhdGUnc1xuICAgKiBwb3N0LWNvbnRlbnQgXHUyMDE0IHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAoYHdyaXR0ZW46ICcnYCkgZWl0aGVyXG4gICAqIHdheS5cbiAgICovXG4gIHdyaXR0ZW4/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYHRydW5jYXRlIC1zIE5gIHNpemUgKHBsYW4gXHUwMEE3NS41KTogdGhlXG4gICAqIFx1MDBBNzMgYHNpemVgIGdhdGUncyBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCAoYC1zIDBgIFx1MjE5MiB0aGUgZW1wdHkgZ2F0ZSkuXG4gICAqIEFic2VudCBmb3IgcmVsYXRpdmUgc2l6ZXMgKGAtcyArTmAvYC1zIC1OYCksIGAtciByZWZgLCBhbmQgZXZlcnkgb3RoZXJcbiAgICogb3BlcmF0aW9uIFx1MjAxNCB0aG9zZSBnYXRlIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc2l6ZT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE9yZGluYWwgb2YgdGhlIHNwYW4ncyBzaW1wbGUgY29tbWFuZCB3aXRoaW4gdGhlIGNvbXBvdW5kLCBpbiB3YWxrZXJcbiAgICogb3JkZXI7IGdyb3VwcyB0aGUgc3BhbnMgb2Ygb25lIGNvbW1hbmQgZm9yIGpvaW4gZ2F0aW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgICovXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIHByZWNlZGluZyB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kOyBvbmx5IGAnJiYnYC9gJ3x8J2AgZ2F0ZS5cbiAgICogQWJzZW50IGZvciBgc3RhcnRgL2A7YC9uZXdsaW5lL2AmYC9gfGAgYm91bmRhcmllcy5cbiAgICovXG4gIGpvaW4/OiAnJiYnIHwgJ3x8JztcbiAgbm90ZT86IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgSWRpb20gPVxuICB8ICdzZWQtbi1yYW5nZSdcbiAgfCAnaGVhZC1maWxlJ1xuICB8ICd0YWlsLWZpbGUnXG4gIHwgJ2NhdC1maWxlJ1xuICB8ICdubC1maWxlJ1xuICB8ICdnaXQtc2hvdy1yZXYtcGF0aCdcbiAgfCAnZ2l0LWxvZy1MJ1xuICB8ICdoZXJlZG9jLXdyaXRlJ1xuICAvLyBUaGUgd3JpdGUtdG91Y2ggZmFtaWxpZXMgKHBsYW4gXHUwMEE3NSkuIElkaW9tIHN0YXlzIG1hdGNoIG1ldGFkYXRhIGZvciB0ZXN0c1xuICAvLyBhbmQgdW5yZXNvbHZlZCByZWFzb25zOyBhZGFwdGVyIGJlaGF2aW9yIGtleXMgb24gYG9wZXJhdGlvbmAsIG5ldmVyIGlkaW9tLlxuICB8ICdyZWRpcmVjdC13cml0ZScgLy8gXHUwMEE3NS4xOiBlY2hvL3ByaW50Zi90ZWUgY29udGVudCByZWRpcmVjdHNcbiAgfCAndHJ1bmNhdGUtd3JpdGUnIC8vIFx1MDBBNzUuMTogYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGlvbnNcbiAgfCAnY3Atd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdpbnN0YWxsLXdyaXRlJyAvLyBcdTAwQTc1LjNcbiAgfCAnbXYtd3JpdGUnIC8vIFx1MDBBNzUuNDogbXYgYW5kIGdpdCBtdlxuICB8ICdybS13cml0ZScgLy8gXHUwMEE3NS41OiBybSBhbmQgZ2l0IHJtXG4gIHwgJ3RydW5jYXRlLWNvbW1hbmQnIC8vIFx1MDBBNzUuNTogdGhlIHRydW5jYXRlIGNvbW1hbmRcbiAgfCAnc2VkLWlucGxhY2UnIC8vIFx1MDBBNzUuNjogc2VkIC1pXG4gIHwgJ3BhdGNoLXdyaXRlJyAvLyBcdTAwQTc1Ljc6IHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgfCAnZm9ybWF0dGVyLXdyaXRlJyAvLyBcdTAwQTc1LjhcbiAgfCAnZ2l0LXJlc3RvcmUtd3JpdGUnIC8vIFx1MDBBNzUuOTogZ2l0IHJlc3RvcmUgcGF0aHNwZWNzXG4gIHwgJ2dpdC1jaGVja291dC13cml0ZSc7IC8vIFx1MDBBNzUuOTogZ2l0IGNoZWNrb3V0IC0tIHBhdGhzcGVjc1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7XG4gICAgICAvKipcbiAgICAgICAqIEEgc3Bhbi1sZXNzIGNvbW1hbmQgd2l0aCBhIGRldGVybWluaXN0aWMgZXhpdCBzdGF0dXMgXHUyMDE0IGBmYWxzZWAgKDEpLFxuICAgICAgICogYHRydWVgICgwKSwgYDpgICgwKS4gTm8gc3BhbiBhbmQgbm8gdG91Y2gsIGJ1dCB0aGUgam9pbiBkcml2ZXIgbmVlZHNcbiAgICAgICAqIHRoZSB2ZXJkaWN0OiBgZmFsc2UgJiYgZWNobyB4ID4gZmAgc2tpcHMgdGhlIGVjaG8sIGB0cnVlIHx8IGVjaG8geCA+XG4gICAgICAgKiBmYCBza2lwcyBpdCB0b28sIGFuZCB3aXRob3V0IHRoZSBndWFyZCBib3RoIHdvdWxkIGZpcmUgYW4gZXhhY3QtZ2F0ZVxuICAgICAgICogdG91Y2ggZm9yIGEgd3JpdGUgdGhhdCBuZXZlciByYW4gKHBsYW4gXHUwMEE3MyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmRcbiAgICAgICAqIHJ1bGUpLiBGaWx0ZXJlZCBvdXQgb2YgYHBhcnNlQ29tbWFuZGAncyBzcGFuIGxpc3Qgd2l0aCB0aGVcbiAgICAgICAqIHVucmVzb2x2ZWRzLlxuICAgICAgICovXG4gICAgICBzdGF0dXM6ICdidWlsdGluLWd1YXJkJztcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAgICAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ107XG4gICAgICBleGl0U3RhdHVzOiAwIHwgMTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUtcmFuZ2Ugc3BlY3M6IHdoYXQgYSBtYXRjaGVkIGlkaW9tIHNheXMgYWJvdXQgdGhlIHJhbmdlLCBiZWZvcmUgd2Uga25vd1xuLy8gd2hldGhlciByZXNvbHZpbmcgaXQgbmVlZHMgdG8gY29uc3VsdCBhIHJlYWwgZmlsZS9naXQgYmxvYi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIExpbmVSYW5nZVNwZWMgPVxuICB8IHsga2luZDogJ2xpdGVyYWwnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCc7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd0b0VvZic7IHN0YXJ0OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2xhc3ROTGluZXMnOyBjb3VudDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdhcHBlbmRMaW5lcyc7IGNvdW50OiBudW1iZXIgfTtcblxuZnVuY3Rpb24gcmVzb2x2ZVNwZWMoXG4gIHNwZWM6IExpbmVSYW5nZVNwZWMsXG4gIHRvdGFsTGluZXM6ICgpID0+IG51bWJlciB8IG51bGxcbik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIHN3aXRjaCAoc3BlYy5raW5kKSB7XG4gICAgY2FzZSAnbGl0ZXJhbCc6XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IHNwZWMuZW5kIH07XG4gICAgY2FzZSAndXBwZXJCb3VuZEZyb21TdGFydCc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiB0b3RhbCAhPT0gbnVsbCA/IE1hdGgubWluKHNwZWMuZW5kLCB0b3RhbCkgOiBzcGVjLmVuZCB9O1xuICAgIH1cbiAgICBjYXNlICd0b0VvZic6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogTWF0aC5tYXgoc3BlYy5zdGFydCwgdG90YWwpIH07XG4gICAgfVxuICAgIGNhc2UgJ2xhc3ROTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IE1hdGgubWF4KDEsIHRvdGFsIC0gc3BlYy5jb3VudCArIDEpLCBsaW5lRW5kOiB0b3RhbCB9O1xuICAgIH1cbiAgICBjYXNlICdhcHBlbmRMaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpID8/IDA7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHRvdGFsICsgMSwgbGluZUVuZDogdG90YWwgKyBzcGVjLmNvdW50IH07XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGhhc1NoZWxsRXhwYW5zaW9uKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1skYF0vLnRlc3Qocyk7XG59XG5cbmZ1bmN0aW9uIGxvb2tzVW5yZXNvbHZhYmxlKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gaGFzU2hlbGxFeHBhbnNpb24ocykgfHwgL1sqP10vLnRlc3Qocyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSWRpb20gbWF0Y2hlcnM6IHB1cmUgZnVuY3Rpb25zIG92ZXIgb25lIHNpbXBsZSBjb21tYW5kJ3MgYXJndi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmF3Q2FuZGlkYXRlIHtcbiAga2luZDogJ2NhbmRpZGF0ZSc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICBzcGVjOiBMaW5lUmFuZ2VTcGVjO1xuICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICBkaXJPdmVycmlkZT86IHN0cmluZztcbn1cbmludGVyZmFjZSBSYXdVbnJlc29sdmVkIHtcbiAga2luZDogJ3VucmVzb2x2ZWQnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgcmVhc29uOiBzdHJpbmc7XG59XG50eXBlIE1hdGNoUmVzdWx0ID0gUmF3Q2FuZGlkYXRlIHwgUmF3VW5yZXNvbHZlZDtcblxuY29uc3QgU0VEX1JBTkdFID0gL14oXFxkKykoPzosKFxcZCt8XFwkKSk/cCQvO1xuXG4vKiogU3BsaXQgYSBgc2VkYCBzY3JpcHQgYXJndW1lbnQgaW50byBpdHMgYDtgLXNlcGFyYXRlZCBzZWdtZW50cy4gKi9cbmZ1bmN0aW9uIHNlZFNjcmlwdFNlZ21lbnRzKHNjcmlwdDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gc2NyaXB0LnNwbGl0KCc7Jyk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoU2VkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnc2VkJykgcmV0dXJuIFtdO1xuICBjb25zdCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKCFyZXN0LmluY2x1ZGVzKCctbicpKSByZXR1cm4gW107XG4gIGxldCBzY3JpcHRJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWRTY3JpcHRTZWdtZW50cyhyZXN0W2ldKS5zb21lKChzZWcpID0+IFNFRF9SQU5HRS50ZXN0KHNlZykpKSB7XG4gICAgICBzY3JpcHRJZHggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVDYW5kaWRhdGVzID0gcmVzdC5maWx0ZXIoKGEsIGkpID0+IGkgIT09IHNjcmlwdElkeCAmJiBhICE9PSAnLW4nICYmICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUFyZyA9IGZpbGVDYW5kaWRhdGVzWzBdO1xuICBjb25zdCByZXN1bHRzOiBNYXRjaFJlc3VsdFtdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWRTY3JpcHRTZWdtZW50cyhyZXN0W3NjcmlwdElkeF0pKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBzZWdtZW50Lm1hdGNoKFNFRF9SQU5HRSk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcbiAgICBjb25zdCBlbmRUb2tlbiA9IG1hdGNoWzJdO1xuICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgZW5kVG9rZW4gPT09IHVuZGVmaW5lZFxuICAgICAgICA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBzdGFydCB9XG4gICAgICAgIDogZW5kVG9rZW4gPT09ICckJ1xuICAgICAgICAgID8geyBraW5kOiAndG9Fb2YnLCBzdGFydCB9XG4gICAgICAgICAgOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogTnVtYmVyLnBhcnNlSW50KGVuZFRva2VuLCAxMCkgfTtcbiAgICByZXN1bHRzLnB1c2goeyBraW5kOiAnY2FuZGlkYXRlJywgaWRpb206ICdzZWQtbi1yYW5nZScsIGZpbGVBcmcsIHNwZWMsIHJlc29sdmVyS2luZDogJ2ZzJyB9KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuZnVuY3Rpb24gcGFyc2VIZWFkVGFpbEZsYWdzKHJlc3Q6IHN0cmluZ1tdKToge1xuICBjb3VudDogbnVtYmVyIHwgbnVsbDtcbiAgZnJvbVN0YXJ0OiBib29sZWFuO1xuICBkaXNxdWFsaWZpZWQ6IGJvb2xlYW47XG4gIGZpbGVzOiBzdHJpbmdbXTtcbn0ge1xuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGNvdW50OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGZyb21TdGFydCA9IGZhbHNlO1xuICBsZXQgZGlzcXVhbGlmaWVkID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctRicgfHwgYSA9PT0gJy0tZm9sbG93JyB8fCBhLnN0YXJ0c1dpdGgoJy0tZm9sbG93PScpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXonIHx8IGEgPT09ICctLXplcm8tdGVybWluYXRlZCcpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycgfHwgYSA9PT0gJy0tYnl0ZXMnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXigtY3wtLWJ5dGVzPSkvLnRlc3QoYSkpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcScgfHwgYSA9PT0gJy12JyB8fCBhID09PSAnLS1xdWlldCcgfHwgYSA9PT0gJy0tc2lsZW50JyB8fCBhID09PSAnLS12ZXJib3NlJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1saW5lcz0nKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoJy0tbGluZXM9Jy5sZW5ndGgpO1xuICAgICAgaWYgKC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tblxcKz9cXGQrJC8udGVzdChhKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoMik7XG4gICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXlxcK1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBmcm9tU3RhcnQgPSB0cnVlO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1cXGQrJC8udGVzdChhKSkge1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBmaWxlcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hIZWFkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnaGVhZCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ2hlYWQtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JywgZW5kOiBuIH0gYXMgTGluZVJhbmdlU3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFRhaWwoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICd0YWlsJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IGZyb21TdGFydCA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IG4gfSA6IHsga2luZDogJ2xhc3ROTGluZXMnLCBjb3VudDogbiB9O1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ3RhaWwtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKFxuICByZXN0OiBzdHJpbmdbXVxuKTogeyBzdWJJZHg6IG51bWJlcjsgc3ViY29tbWFuZDogc3RyaW5nOyBjRGlyOiBzdHJpbmcgfCBudWxsOyBjRGlyVW5yZXNvbHZhYmxlOiBib29sZWFuIH0gfCBudWxsIHtcbiAgbGV0IGNEaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgY0RpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgcmVzdC5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGNEaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBjRGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IHN1YklkeDogaSwgc3ViY29tbWFuZDogYSwgY0RpciwgY0RpclVucmVzb2x2YWJsZSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5jb25zdCBSRVZfUEFUSCA9IC9eKFteXFxzOl0rKTooLispJC87XG5cbmZ1bmN0aW9uIG1hdGNoR2l0U2hvdyhhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnc2hvdycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2XG4gICAgLnNsaWNlKDEpXG4gICAgLnNsaWNlKHN1Yi5zdWJJZHggKyAxKVxuICAgIC5maWx0ZXIoKGEpID0+ICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGNvbnN0IHJldlBhdGhBcmcgPSBhZnRlci5maW5kKChhKSA9PiBSRVZfUEFUSC50ZXN0KGEpKTtcbiAgaWYgKCFyZXZQYXRoQXJnKSByZXR1cm4gW107XG4gIGNvbnN0IG0gPSByZXZQYXRoQXJnLm1hdGNoKFJFVl9QQVRIKTtcbiAgaWYgKCFtKSByZXR1cm4gW107XG4gIGNvbnN0IFssIHJldiwgcGF0aF0gPSBtO1xuICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUgfHwgaGFzU2hlbGxFeHBhbnNpb24ocmV2KSkge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgb3IgcmV2aXNpb24gY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXG4gICAge1xuICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCcsIHJldiB9LFxuICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgIH1cbiAgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hHaXRMb2dMKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdsb2cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndi5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYWZ0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYWZ0ZXJbaV07XG4gICAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhID09PSAnLUwnKSBzcGVjID0gYWZ0ZXJbaSArIDFdID8/IG51bGw7XG4gICAgZWxzZSBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSBzcGVjID0gYS5zbGljZSgyKTtcbiAgICBpZiAoIXNwZWMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG0gPSBzcGVjLm1hdGNoKC9eKFxcZCspLChcXGQrKTooLispJC8pO1xuICAgIGlmICghbSkgY29udGludWU7XG4gICAgY29uc3QgWywgcywgZSwgcGF0aF0gPSBtO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogTnVtYmVyLnBhcnNlSW50KHMsIDEwKSwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZSwgMTApIH0sXG4gICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJyxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlcmVkb2Mgd3JpdGVzIChwbGFuIFx1MDBBNzUuMik6IGhhbmRsZWQgYXMgYSBkZWRpY2F0ZWQgcmF3LXRleHQgcGFzcyBiZWNhdXNlIHRoZVxuLy8gYm9keSBjYW4gaXRzZWxmIGNvbnRhaW4gJiYvOy98L25ld2xpbmVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIGNvbmZ1c2Vcbi8vIHNwbGl0VG9wTGV2ZWwuIFRoZSBvcGVuZXIgc2Nhbm5lciBpcyBxdW90ZS1hd2FyZSBhbmQgdmFsaWRhdGVzIHRoZSBjbG9zaW5nXG4vLyBkZWxpbWl0ZXI7IG1hdGNoZWQgaGVyZWRvY3MgYXJlIG1hc2tlZCBvdXQgb2YgdGhlIHN0cmluZyAocmVwbGFjZWQgd2l0aCBhblxuLy8gaW5kZXhlZCBwbGFjZWhvbGRlciBzaW1wbGUtY29tbWFuZCkgYmVmb3JlIHRoZSByZXN0IG9mIHRoZSBwaXBlbGluZSBydW5zLFxuLy8gYW5kIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSBtYWluIHdhbGsgc28gdGhlIHdyaXRlIGlzIHJlc29sdmVkXG4vLyBhZ2FpbnN0IHRoZSBjb3JyZWN0IGBjZGAtdHJhY2tlZCBkaXJlY3RvcnkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBoZXJlZG9jJ3MgY29udGVudC1jYXJyeWluZyBmYWN0cywgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIHdhbGsuICovXG5pbnRlcmZhY2UgSGVyZWRvY1dyaXRlIHtcbiAgLyoqIFRoZSBvcGVuZXIgbGluZSB2ZXJiYXRpbSAoZS5nLiBgY2F0ID4gZiA8PCdFT0YnYCksIHJlLXRva2VuaXplZCBkdXJpbmcgdGhlIHdhbGsuICovXG4gIG9wZW5lcjogc3RyaW5nO1xuICAvKiogVGhlIGhlcmVkb2MgYm9keTsgYDw8LWAgYm9kaWVzIGhhdmUgbGVhZGluZyB0YWJzIHN0cmlwcGVkIHBlciBsaW5lLiAqL1xuICBib2R5OiBzdHJpbmc7XG4gIC8qKiBXaGV0aGVyIHRoZSBkZWxpbWl0ZXIgd2FzIHF1b3RlZC9lc2NhcGVkIChgPDwnRU9GJ2AsIGA8PFwiRU9GXCJgLCBgPDxcXEVPRmApOiB0aGUgYm9keSB0aGVuIHVuZGVyZ29lcyBubyBzaGVsbCBleHBhbnNpb24uICovXG4gIHF1b3RlZERlbGltOiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgSGVyZWRvY09wZW5lciB7XG4gIC8qKiBXaGVyZSB0aGUgaGVyZWRvYydzIHNpbXBsZSBjb21tYW5kIHN0YXJ0cyBpbiB0aGUgcmF3IHN0cmluZy4gKi9cbiAgY21kU3RhcnQ6IG51bWJlcjtcbiAgLyoqIFRoZSBuZXdsaW5lIGVuZGluZyB0aGUgb3BlbmVyIGxpbmUsIG9yIHJhdy5sZW5ndGggd2hlbiBpdCdzIHRoZSBsYXN0IGxpbmUuICovXG4gIG9wZW5lckxpbmVFbmQ6IG51bWJlcjtcbiAgLyoqIFRoZSBjbG9zaW5nIGRlbGltaXRlciAocXVvdGVzIHN0cmlwcGVkKS4gKi9cbiAgZGVsaW06IHN0cmluZztcbiAgLyoqIGA8PC1gOiBzdHJpcCBsZWFkaW5nIHRhYnMgZnJvbSB0aGUgYm9keSBhbmQgdGhlIGNsb3NlciBsaW5lLiAqL1xuICB0YWJTdHJpcDogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgdGhlIGRlbGltaXRlciB3YXMgcXVvdGVkL2VzY2FwZWQgXHUyMDE0IHRoZSBzaGVsbCBza2lwcyBib2R5IGV4cGFuc2lvbiB0aGVuLiAqL1xuICBxdW90ZWREZWxpbTogYm9vbGVhbjtcbn1cblxuY29uc3QgQkFSRV9ERUxJTSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKiQvO1xuXG4vKipcbiAqIEZpbmQgdGhlIG5leHQgaGVyZWRvYyBvcGVuZXIgKGA8PGAvYDw8LWApIGF0IHRvcCBsZXZlbCwgc2Nhbm5pbmcgZnJvbVxuICogYGZyb21gLiBNaXJyb3JzIHNwbGl0VG9wTGV2ZWwncyBzZXBhcmF0b3IgaGFuZGxpbmcgc28gYGNtZFN0YXJ0YCBtYXJrcyB0aGVcbiAqIG9wZW5lcidzIG93biBzaW1wbGUgY29tbWFuZDogdG9wLWxldmVsIGAmJmAvYHx8YC9gO2AvbmV3bGluZS9gJmAgc3RhcnQgYSBuZXdcbiAqIGNvbW1hbmQgKGEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiksIGA+YC1yZWRpcmVjdHMsIGR1cFxuICogcmVkaXJlY3RzIChgMj4mMWApIGFuZCBwYXJlbiBuZXN0aW5nIHN0YXkgaW5zaWRlIHRoZSBjb21tYW5kLCBhbmRcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApIGFyZSBvdXQgb2Ygc2NvcGUuIEFuIElPX05VTUJFUiBmZCBkaXJlY3RseSBiZWZvcmUgdGhlXG4gKiBvcGVyYXRvciAoYDI8PEVPRmApIHJlZGlyZWN0cyB0aGF0IGZkLCBub3Qgc3RkaW4gXHUyMDE0IG5vdCBhIGhlcmVkb2MuIFJldHVybnNcbiAqIG51bGwgd2hlbiBubyBvcGVuZXIgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGZpbmRIZXJlZG9jT3BlbmVyKHJhdzogc3RyaW5nLCBmcm9tOiBudW1iZXIpOiBIZXJlZG9jT3BlbmVyIHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBjbWRTdGFydCA9IGZyb207XG4gIGxldCBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICBsZXQgaSA9IGZyb207XG5cbiAgLyoqIFJlYWQgb25lIGRlbGltaXRlciB3b3JkIHN0YXJ0aW5nIGF0IGBzdGFydGAgKHRoZSBhdHRhY2hlZCB0YWlsIG9mIGA8PEVPRmAvYDw8J0VPRidgLCBvciBhIHN0YW5kYWxvbmUgbmV4dCB3b3JkKS4gUXVvdGVzIGNvbnRyaWJ1dGUgdGhlaXIgY29udGVudDsgYSBiYWNrc2xhc2ggZXNjYXBlcyB0aGUgbmV4dCBjaGFyLiBSZXR1cm5zIG51bGwgb24gYW4gdW5iYWxhbmNlZCBxdW90ZSAoZmFpbCBjbG9zZWQpLiAqL1xuICBjb25zdCByZWFkRGVsaW1Xb3JkID0gKHN0YXJ0OiBudW1iZXIpOiB7IGRlbGltOiBzdHJpbmc7IHNhd1F1b3RlOiBib29sZWFuOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBkID0gJyc7XG4gICAgbGV0IHNhd1F1b3RlID0gZmFsc2U7XG4gICAgbGV0IGsgPSBzdGFydDtcbiAgICB3aGlsZSAoayA8IG4gJiYgIS9cXHMvLnRlc3QocmF3W2tdKSAmJiByYXdba10gIT09ICc8JyAmJiByYXdba10gIT09ICc+Jykge1xuICAgICAgY29uc3QgYyA9IHJhd1trXTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgICAgbGV0IG0gPSBrICsgMTtcbiAgICAgICAgd2hpbGUgKG0gPCBuICYmIHJhd1ttXSAhPT0gcXVvdGUpIHtcbiAgICAgICAgICBkICs9IHJhd1ttXTtcbiAgICAgICAgICBtICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG0gPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICAgIHNhd1F1b3RlID0gdHJ1ZTtcbiAgICAgICAgayA9IG0gKyAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgayArIDEgPCBuKSB7XG4gICAgICAgIC8vIEEgYmFja3NsYXNoLWVzY2FwZWQgZGVsaW1pdGVyIGNoYXIgcXVvdGVzIHRoZSBkZWxpbWl0ZXIgXHUyMDE0IHRoZSBib2R5XG4gICAgICAgIC8vIGlzIGxpdGVyYWwgKGA8PFxcRU9GYCksIHNhbWUgYXMgcXVvdGVzLlxuICAgICAgICBkICs9IHJhd1trICsgMV07XG4gICAgICAgIHNhd1F1b3RlID0gdHJ1ZTtcbiAgICAgICAgayArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGQgKz0gYztcbiAgICAgIGsgKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGVsaW06IGQsIHNhd1F1b3RlLCBuZXh0OiBrIH07XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHJhd1tpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID4gMCkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnJiYnLCBpKSB8fCByYXcuc3RhcnRzV2l0aCgnfHwnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMjtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCd8JicsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAvLyBBIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24gKG1pcnJvcmluZ1xuICAgICAgLy8gc3BsaXRUb3BMZXZlbCk7IGFueXRoaW5nIGVsc2Ugc3RhcnRzIGEgbmV3IHNpbXBsZSBjb21tYW5kLlxuICAgICAgaWYgKCFwZW5kaW5nUGlwZSkgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIGFuZCBkdXAgcmVkaXJlY3RzIChgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdFxuICAgICAgLy8gY29tbWFuZCBzZXBhcmF0b3JzIChtaXJyb3Jpbmcgc3BsaXRUb3BMZXZlbCkuXG4gICAgICBjb25zdCB0cmltbWVkID0gcmF3LnNsaWNlKGNtZFN0YXJ0LCBpKS50cmltRW5kKCk7XG4gICAgICBjb25zdCBkdXBSZWRpcmVjdCA9XG4gICAgICAgIHRyaW1tZWQuZW5kc1dpdGgoJz4nKSAmJiAodHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QodHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdID8/ICcnKSk7XG4gICAgICBpZiAocmF3W2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnICYmIHJhd1tpICsgMV0gPT09ICc8Jykge1xuICAgICAgLy8gYDw8PGAgaXMgYSBoZXJlLXN0cmluZyAob3V0IG9mIHNjb3BlKTsgYDw8LWAgc3RyaXBzIGxlYWRpbmcgdGFicy5cbiAgICAgIGlmIChyYXdbaSArIDJdID09PSAnPCcpIHtcbiAgICAgICAgaSArPSAzO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGxldCBqID0gaSAtIDE7XG4gICAgICB3aGlsZSAoaiA+PSBmcm9tICYmIC9cXGQvLnRlc3QocmF3W2pdKSkgaiAtPSAxO1xuICAgICAgY29uc3QgaW9OdW1iZXIgPSBqIDwgaSAtIDEgJiYgKGogPCBmcm9tIHx8IC9cXHN8Wzt8JihdLy50ZXN0KHJhd1tqXSkpO1xuICAgICAgaWYgKGlvTnVtYmVyKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB0YWJTdHJpcCA9IHJhd1tpICsgMl0gPT09ICctJztcbiAgICAgIGNvbnN0IG9wTGVuID0gdGFiU3RyaXAgPyAzIDogMjtcbiAgICAgIGNvbnN0IGxpbmVFbmQgPSByYXcuaW5kZXhPZignXFxuJywgaSk7XG4gICAgICBjb25zdCBvcGVuZXJMaW5lRW5kID0gbGluZUVuZCA9PT0gLTEgPyBuIDogbGluZUVuZDtcbiAgICAgIGNvbnN0IGF0dGFjaGVkID0gcmVhZERlbGltV29yZChpICsgb3BMZW4pO1xuICAgICAgbGV0IGRlbGltID0gYXR0YWNoZWQgPT09IG51bGwgPyAnJyA6IGF0dGFjaGVkLmRlbGltO1xuICAgICAgbGV0IHNhd1F1b3RlID0gYXR0YWNoZWQgPT09IG51bGwgPyBmYWxzZSA6IGF0dGFjaGVkLnNhd1F1b3RlO1xuICAgICAgaWYgKGRlbGltID09PSAnJyAmJiBhdHRhY2hlZCAhPT0gbnVsbCkge1xuICAgICAgICAvLyBTdGFuZGFsb25lIG9wZXJhdG9yOiB0aGUgZGVsaW1pdGVyIGlzIHRoZSBuZXh0IHdvcmQuXG4gICAgICAgIGxldCBrID0gYXR0YWNoZWQubmV4dDtcbiAgICAgICAgd2hpbGUgKGsgPCBvcGVuZXJMaW5lRW5kICYmIC9cXHMvLnRlc3QocmF3W2tdKSkgayArPSAxO1xuICAgICAgICBjb25zdCB3b3JkID0gcmVhZERlbGltV29yZChrKTtcbiAgICAgICAgaWYgKHdvcmQgPT09IG51bGwpIGRlbGltID0gJyc7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGRlbGltID0gd29yZC5kZWxpbTtcbiAgICAgICAgICBzYXdRdW90ZSA9IHdvcmQuc2F3UXVvdGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChkZWxpbSA9PT0gJycgfHwgKCFzYXdRdW90ZSAmJiAhQkFSRV9ERUxJTS50ZXN0KGRlbGltKSkpIHtcbiAgICAgICAgLy8gTm8gZGVsaW1pdGVyLCBvciBhIGJhcmUgZm9ybSBvdXRzaWRlIHRoZSBpZGVudGlmaWVyIHNoYXBlIFx1MjAxNCBmYWlsXG4gICAgICAgIC8vIGNsb3NlZCBhbmQga2VlcCBzY2FubmluZyBwYXN0IHRoZSBvcGVyYXRvci5cbiAgICAgICAgaSArPSBvcExlbjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBjbWRTdGFydCwgb3BlbmVyTGluZUVuZCwgZGVsaW0sIHRhYlN0cmlwLCBxdW90ZWREZWxpbTogc2F3UXVvdGUgfTtcbiAgICB9XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSBib2R5IG9mIGFuIG9wZW5lciBydW5zIGZyb20gYWZ0ZXIgdGhlIG9wZW5lciBsaW5lJ3MgbmV3bGluZSB0byB0aGUgbGluZVxuICogdGhhdCBpcyBleGFjdGx5IHRoZSBkZWxpbWl0ZXIgKGA8PGApLCBvciBpdHMgbGVhZGluZy10YWItc3RyaXBwZWQgZm9ybVxuICogKGA8PC1gKSwgdHJhaWxpbmcgd2hpdGVzcGFjZSBhbGxvd2VkLiBSZXR1cm5zIHRoZSBjbG9zZXIncyBsaW5lIGJvdW5kcywgb3JcbiAqIG51bGwgd2hlbiBubyBjbG9zZXIgZXhpc3RzIChmYWlsIGNsb3NlZCkuXG4gKi9cbmZ1bmN0aW9uIGhlcmVkb2NDbG9zZXIocmF3OiBzdHJpbmcsIG9wZW46IEhlcmVkb2NPcGVuZXIpOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBuID0gcmF3Lmxlbmd0aDtcbiAgY29uc3QgYm9keVN0YXJ0ID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgbiA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiBuO1xuICBsZXQgbGluZVBvcyA9IGJvZHlTdGFydDtcbiAgd2hpbGUgKGxpbmVQb3MgPCBuKSB7XG4gICAgY29uc3QgbmwgPSByYXcuaW5kZXhPZignXFxuJywgbGluZVBvcyk7XG4gICAgY29uc3QgbGluZUVuZCA9IG5sID09PSAtMSA/IG4gOiBubDtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBvcGVuLnRhYlN0cmlwID8gcmF3LnNsaWNlKGxpbmVQb3MsIGxpbmVFbmQpLnJlcGxhY2UoL15cXHQrLywgJycpIDogcmF3LnNsaWNlKGxpbmVQb3MsIGxpbmVFbmQpO1xuICAgIGlmIChcbiAgICAgIGNhbmRpZGF0ZSA9PT0gb3Blbi5kZWxpbSB8fFxuICAgICAgKGNhbmRpZGF0ZS5zdGFydHNXaXRoKG9wZW4uZGVsaW0pICYmIC9eWyBcXHRdKiQvLnRlc3QoY2FuZGlkYXRlLnNsaWNlKG9wZW4uZGVsaW0ubGVuZ3RoKSkpXG4gICAgKSB7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IGxpbmVQb3MsIGxpbmVFbmQgfTtcbiAgICB9XG4gICAgaWYgKG5sID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgbGluZVBvcyA9IG5sICsgMTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBNYXNrIGV2ZXJ5IGhlcmVkb2Mgb3V0IG9mIHRoZSByYXcgY29tbWFuZCBzdHJpbmcsIHJldHVybmluZyB0aGUgYm9kaWVzIGFuZFxuICogb3BlbmVycyBmb3IgcmUtYXNzb2NpYXRpb24gYnkgaW5kZXguIFRoZSBtYXNrIGNvdmVyc1xuICogYFtjbWRTdGFydCwgY2xvc2VyTGluZUVuZClgIFx1MjAxNCB0aGUgb3BlbmVyIGxpbmUgdGhyb3VnaCB0aGUgY2xvc2VyIGxpbmUsIHRoZVxuICogY2xvc2VyJ3MgbmV3bGluZSBleGNsdWRlZCBcdTIwMTQgc28gYSBjb21tYW5kIGpvaW5lZCBiZWZvcmUgdGhlIG9wZW5lclxuICogKGBjbWQxICYmIGNhdCA8PEVPRmApIGtlZXBzIGl0cyBzdHJ1Y3R1cmUsIGFuZCB0aGUgcGxhY2Vob2xkZXIgc3RhbmRzIGFsb25lXG4gKiBhcyBpdHMgb3duIHNpbXBsZSBjb21tYW5kLiBBIGhlcmVkb2Mgd2l0aG91dCBhIGNsb3NlciBmYWlscyBjbG9zZWQ6IGl0c1xuICogb3BlbmVyIGxpbmUgc3RheXMgdW5tYXNrZWQgYW5kIHNjYW5uaW5nIHJlc3VtZXMgYWZ0ZXIgaXQuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RIZXJlZG9jV3JpdGVzKHJhdzogc3RyaW5nKTogeyB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdOyBtYXNrZWQ6IHN0cmluZyB9IHtcbiAgY29uc3Qgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXSA9IFtdO1xuICBsZXQgbWFza2VkID0gJyc7XG4gIGxldCBjdXJzb3IgPSAwO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3Qgb3BlbiA9IGZpbmRIZXJlZG9jT3BlbmVyKHJhdywgY3Vyc29yKTtcbiAgICBpZiAob3BlbiA9PT0gbnVsbCkgYnJlYWs7XG4gICAgY29uc3QgY2xvc2UgPSBoZXJlZG9jQ2xvc2VyKHJhdywgb3Blbik7XG4gICAgaWYgKGNsb3NlID09PSBudWxsKSB7XG4gICAgICBjdXJzb3IgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYm9keVN0YXJ0ID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgcmF3Lmxlbmd0aCA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiByYXcubGVuZ3RoO1xuICAgIGxldCBib2R5ID0gcmF3LnNsaWNlKGJvZHlTdGFydCwgY2xvc2UubGluZVN0YXJ0KS5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgIGlmIChvcGVuLnRhYlN0cmlwKSBib2R5ID0gYm9keS5yZXBsYWNlKC9eXFx0Ky9nbSwgJycpO1xuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuLmNtZFN0YXJ0KTtcbiAgICBtYXNrZWQgKz0gYF9faGVyZWRvY18ke3dyaXRlcy5sZW5ndGh9X19gO1xuICAgIHdyaXRlcy5wdXNoKHsgb3BlbmVyOiByYXcuc2xpY2Uob3Blbi5jbWRTdGFydCwgb3Blbi5vcGVuZXJMaW5lRW5kKSwgYm9keSwgcXVvdGVkRGVsaW06IG9wZW4ucXVvdGVkRGVsaW0gfSk7XG4gICAgY3Vyc29yID0gY2xvc2UubGluZUVuZDtcbiAgfVxuICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvcik7XG4gIHJldHVybiB7IHdyaXRlcywgbWFza2VkIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVkaXJlY3QtdG9rZW4gYW5hbHlzaXMgYW5kIHRoZSB3cml0ZS10b3VjaCBncmFtbWFycyAocGxhbiBcdTAwQTc1LjEsIFx1MDBBNzUuMikuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJlZGlyZWN0SW5mbyB7XG4gIC8qKiBJT19OVU1CRVIgZmQgKGAxPmAvYDI+YCksIG9yIG51bGwgd2hlbiBpbXBsaWNpdC4gKi9cbiAgZmQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBUaGUgb3BlcmF0b3IuICovXG4gIG9wOiAnPicgfCAnPj4nIHwgJyY+JyB8ICcmPj4nIHwgJz4mJyB8ICc8JyB8ICc8PCcgfCAnPDwtJyB8ICc8PDwnO1xuICAvKiogQXR0YWNoZWQgdGFyZ2V0IHRleHQsIG9yIG51bGwgZm9yIGEgc3RhbmRhbG9uZSBvcGVyYXRvciAodGFyZ2V0ID0gbmV4dCB0b2tlbikuICovXG4gIHRhcmdldDogc3RyaW5nIHwgbnVsbDtcbn1cblxuY29uc3QgUkVESVJFQ1RfVE9LRU4gPSAvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvO1xuXG5mdW5jdGlvbiBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odGV4dDogc3RyaW5nKTogUmVkaXJlY3RJbmZvIHwgbnVsbCB7XG4gIGNvbnN0IG0gPSB0ZXh0Lm1hdGNoKFJFRElSRUNUX1RPS0VOKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCBmZFRleHQsIG9wLCB0YXJnZXRdID0gbTtcbiAgcmV0dXJuIHtcbiAgICBmZDogZmRUZXh0ID09PSAnJyA/IG51bGwgOiBOdW1iZXIucGFyc2VJbnQoZmRUZXh0LCAxMCksXG4gICAgb3A6IG9wIGFzIFJlZGlyZWN0SW5mb1snb3AnXSxcbiAgICB0YXJnZXQ6IHRhcmdldCA9PT0gJycgPyBudWxsIDogdGFyZ2V0XG4gIH07XG59XG5cbi8qKlxuICogQSBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdCAocGxhbiBcdTAwQTc1LjEpOiBmZC0xIGA+YC9gPj5gIChleHBsaWNpdCBgMT5gL2AxPj5gXG4gKiBpbmNsdWRlZCkgYW5kIGAmPmAvYCY+PmAuIEZELW51bWJlcmVkIChgMj5gKSwgZHVwIChgMj4mMWAsIGA+JmZgKSxcbiAqIGAmYC1sZWFkaW5nLXRhcmdldCBkdXAgKGA+JmApIGFuZCBzdGRpbiAoYDxgKSBmb3JtcyBuZXZlciBwcm9kdWNlIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGlzQ29udGVudFJlZGlyZWN0KHI6IFJlZGlyZWN0SW5mbyk6IGJvb2xlYW4ge1xuICBpZiAoci5vcCA9PT0gJz4nIHx8IHIub3AgPT09ICc+PicpIHtcbiAgICBpZiAoci5mZCAhPT0gbnVsbCAmJiByLmZkICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHIudGFyZ2V0Py5zdGFydHNXaXRoKCcmJykpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gci5vcCA9PT0gJyY+JyB8fCByLm9wID09PSAnJj4+Jztcbn1cblxuLyoqIFRoZSBhcmd2IHN0cmVhbSBhbmQgcmVkaXJlY3QgbGlzdCBvZiBhIHNpbXBsZSBjb21tYW5kIChwbGFuIFx1MDBBNzUuMTApOiB3b3JkcyBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kIHRoZWlyIHRhcmdldHMuICovXG5mdW5jdGlvbiBhbmFseXplVG9rZW5zKHRva2VuczogVG9rZW5bXSk6IHsgYXJndjogc3RyaW5nW107IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gfSB7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmZvID0gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRva2VuLnRleHQpO1xuICAgIGlmIChpbmZvID09PSBudWxsKSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluZm8udGFyZ2V0ID09PSBudWxsKSB7XG4gICAgICAvLyBBIHN0YW5kYWxvbmUgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldCAob3JcbiAgICAgIC8vIGhlcmVkb2MgZGVsaW1pdGVyIC8gaGVyZS1zdHJpbmcgY29udGVudCkgXHUyMDE0IGF0dGFjaGVkIHRvIHRoZSByZWRpcmVjdFxuICAgICAgLy8gc28gdGhlIHdyaXRlIGdyYW1tYXJzIHNlZSBpdCwgYW5kIGV4Y2x1ZGVkIGZyb20gYXJndi5cbiAgICAgIGNvbnN0IG5leHQgPSB0b2tlbnNbaSArIDFdO1xuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhbmV4dC5pc1JlZGlyZWN0KSB7XG4gICAgICAgIHJlZGlyZWN0cy5wdXNoKHsgLi4uaW5mbywgdGFyZ2V0OiBuZXh0LnRleHQgfSk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJlZGlyZWN0cy5wdXNoKGluZm8pO1xuICB9XG4gIHJldHVybiB7IGFyZ3YsIHJlZGlyZWN0cyB9O1xufVxuXG4vKipcbiAqIExpdGVyYWwgYGVjaG9gL2BwcmludGZgIGNvbnRlbnQgKHBsYW4gXHUwMEE3NS4xKSBmb3IgYm9keSB0aHJlYWRpbmc6IG5vXG4gKiBmbGFncywgbm8gc2hlbGwgZXhwYW5zaW9uLCBubyBnbG9iczsgYHByaW50ZmAgb25seSB3aGVuIHRoZSBmb3JtYXQgaGFzIG5vXG4gKiBgJWAvYmFja3NsYXNoIGRpcmVjdGl2ZXMgKHRoZW4gdGhlIGZvcm1hdCBpdHNlbGYgaXMgdGhlIGxpdGVyYWwgY29udGVudCkuXG4gKiBUaHJlYWRlZCBvbiBhcHBlbmRzIGFzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgYW5kIG9uIHNpbmdsZSBwbGFpbiBgPmBcbiAqIG92ZXJ3cml0ZXMgKGFuZCB0ZWUgb3BlcmFuZHMgd2l0aCBhIG9uZS1ob3AgbGl0ZXJhbCBwaXBlIHNvdXJjZSkgYXMgdGhlXG4gKiBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50LlxuICovXG5mdW5jdGlvbiBsaXRlcmFsQ29udGVudChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBhcmdzID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSB8fCBoYXNTaGVsbEV4cGFuc2lvbihhKSB8fCAvWyo/XS8udGVzdChhKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3ByaW50ZicpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggIT09IDEpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgZm10ID0gYXJnc1swXTtcbiAgICBpZiAoZm10LmluY2x1ZGVzKCclJykgfHwgZm10LmluY2x1ZGVzKCdcXFxcJykpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGZtdDtcbiAgfVxuICByZXR1cm4gYCR7YXJncy5qb2luKCcgJyl9XFxuYDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgcmVkaXJlY3QgdGFyZ2V0IGFnYWluc3QgdGhlIGN1cnJlbnQgZGlyZWN0b3J5LCBlbWl0dGluZyB0aGVcbiAqIHVucmVzb2x2ZWQgdmVyZGljdCAodGhlIHJlYWQgaWRpb21zJyByZWFzb24pIHdoZW4gdGhlIHBhdGggY2FycmllcyBhblxuICogdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iLiBSZXR1cm5zIHRoZSBhYnNvbHV0ZSBwYXRoLCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlVGFyZ2V0KHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIHRhcmdldDogc3RyaW5nLCBjdXJyZW50RGlyOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHRhcmdldCkpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICBpZGlvbSxcbiAgICAgIGZpbGVBcmc6IHRhcmdldCxcbiAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xufVxuXG4vKiogVGhlIGB0ZWVgIG9wZXJhbmQgZ3JhbW1hcjogYXBwZW5kIG1vZGUgYW5kIG9wZXJhbmQgbGlzdDsgdW5rbm93biBvcHRpb25zIHJldHVybiBudWxsIChmYWlsIGNsb3NlZCkuICovXG5mdW5jdGlvbiB0ZWVPcGVyYW5kUGFydHMoYXJndjogc3RyaW5nW10pOiB7IGFwcGVuZDogYm9vbGVhbjsgb3BlcmFuZHM6IHN0cmluZ1tdIH0gfCBudWxsIHtcbiAgbGV0IGFwcGVuZCA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3Yuc2xpY2UoMSkpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYScgfHwgYSA9PT0gJy0tYXBwZW5kJykge1xuICAgICAgYXBwZW5kID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHJldHVybiBudWxsO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgYXBwZW5kLCBvcGVyYW5kcyB9O1xufVxuXG4vKipcbiAqIFRoZSBgdGVlYCBvcGVyYW5kIHdyaXRlcyAocGxhbiBcdTAwQTc1LjEpOiBlYWNoIG9wZXJhbmQgaXMgYSB3aG9sZS1maWxlXG4gKiBjcmVhdGUtb3ZlcndyaXRlICh0cnVuY2F0aW5nKSwgb3IgYSB3aG9sZS1maWxlIGFwcGVuZCB1bmRlciBgLWFgL2AtLWFwcGVuZGAuXG4gKiBBIG9uZS1ob3AgbGl0ZXJhbCBlY2hvL3ByaW50ZiBwaXBlIHNvdXJjZSAoYGVjaG8geCB8IHRlZSBmYCwgYHByaW50ZiB5IHxcbiAqIHRlZSAtYSBmYCwgcGxhbiBcdTAwQTc1LjIpIHRocmVhZHMgYXMgdGhlIHdyaXR0ZW4gYm9keSBcdTIwMTQgdGhlIGV4YWN0IGdhdGUnc1xuICogcG9zdC1jb250ZW50IG9uIHRoZSB0cnVuY2F0aW5nIHdyaXRlLCB0aGUgc3VmZml4IGdhdGUncyBib2R5IG9uIHRoZSBhcHBlbmQ7XG4gKiB3aXRob3V0IGEga25vd24gc291cmNlIG5laXRoZXIgb3AgY2FycmllcyB3cml0dGVuIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVGVlT3BlcmFuZHMoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICBpZiAocGFydHMgPT09IG51bGwpIHJldHVybjtcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICBzcGFuOiAhcGFydHMuYXBwZW5kXG4gICAgICAgID8ge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSByZWRpcmVjdCBmYW1pbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjEpLCBydW4gZm9yIGV2ZXJ5IHNpbXBsZSBjb21tYW5kIGFmdGVyXG4gKiB0aGUgcmVhZCBtYXRjaGVyczogY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3RzIG9uIGBlY2hvYC9gcHJpbnRmYC9gdGVlYFxuICogd3JpdGUgd2hvbGUtZmlsZTsgYSBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0ZXMgKHRoZSBtYWluIHdhbGsgaGFuZHNcbiAqIGFyZ3YtZW1wdHkgY29tbWFuZHMgZGlyZWN0bHkgaGVyZSk7IGA+PmAtb25seSB0cnVuY2F0aW9uIGZvcm1zIGFwcGVuZFxuICogbm90aGluZyBhbmQgdG91Y2ggbm90aGluZy4gQW55IG90aGVyIGhvc3Qgd2l0aCBhIGNvbnRlbnQgcmVkaXJlY3QgKGBscyA+IGZgLFxuICogYHB5dGhvbjMgeC5weSA+IG91dGAsIGBjYXQgZiA+IGdgKSBnZXRzIG5vIHdyaXRlIHRvdWNoIFx1MjAxNCB0aGUgcmVkaXJlY3QgaXNcbiAqIHJlYWwsIGJ1dCBpdHMgY29udGVudCBpcyBkeW5hbWljIGFuZCBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGV4YWN0bHkgb25lIHBsYWluIGA+PmAgKG9yIGAxPj5gKSBjb250ZW50IHJlZGlyZWN0IG9uIGFcbiAqIGZ1bGx5IGxpdGVyYWwgYGVjaG9gL2BwcmludGZgIHRocmVhZHMgdGhlIHdyaXR0ZW4gYm9keSAodGhlIHN1ZmZpeCBnYXRlKSxcbiAqIGFuZCBleGFjdGx5IG9uZSBwbGFpbiBgPmAgKG9yIGAxPmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gdGhlIHNhbWUgbGl0ZXJhbHNcbiAqIHRocmVhZHMgaXQgYXMgdGhlIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiIFx1MjAxNCB0aGVcbiAqIGNvbnRlbnQgbGF5ZXIgaXMgd2hhdCBzdXBwcmVzc2VzIGBlY2hvIGhpID4gcmVhZC1vbmx5LWZpbGVgLCB3aGVyZSB0aGVcbiAqIGZpbGUgc3RheXMgcHJlc2VudCBidXQgdW5jaGFuZ2VkKS4gYCY+YC9gJj4+YCwgbXVsdGktcmVkaXJlY3QgY29tbWFuZHMsXG4gKiBhbmQgYHRlZWAncyBvd24gcmVkaXJlY3RzIG5ldmVyIHRocmVhZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZWRpcmVjdEZhbWlseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudFJlZGlyZWN0cyA9IHJlZGlyZWN0cy5maWx0ZXIoaXNDb250ZW50UmVkaXJlY3QpO1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09IHVuZGVmaW5lZCB8fCBob3N0ID09PSAnOicgfHwgaG9zdCA9PT0gJ2V4ZWMnKSB7XG4gICAgLy8gQmFyZSBgPiBmYCwgYDogPiBmYCBhbmQgYGV4ZWMgPiBmYCB0cnVuY2F0ZSAoZXhlYyBhcHBsaWVzIHRoZSByZWRpcmVjdFxuICAgIC8vIHRvIHRoZSBzaGVsbCdzIG93biBmZCAxIGltbWVkaWF0ZWx5IFx1MjAxNCB0aGUgZmQtMSB0YXJnZXQgaXMgc3RhdGljLCBzbyB0aGVcbiAgICAvLyB0cnVuY2F0aW9uIGhhcHBlbnMgZXZlbiB0aG91Z2ggdGhlIGNvbW1hbmQgbmV2ZXIgd3JpdGVzKTtcbiAgICAvLyBgPj5gL2AmPj5gIGFwcGVuZCBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC5cbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicgfHwgci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAndHJ1bmNhdGUtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICd0cnVuY2F0ZS13cml0ZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicgJiYgaG9zdCAhPT0gJ3RlZScpIHJldHVybjtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcbiAgY29uc3QgdGhyZWFkZWRBcHBlbmQgPSBzaW5nbGVQbGFpbkFwcGVuZCAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBjb25zdCB0aHJlYWRlZE92ZXJ3cml0ZSA9IHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZEFwcGVuZCAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZEFwcGVuZCB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZE92ZXJ3cml0ZSAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZE92ZXJ3cml0ZSB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmaWxlLW11dGF0aW9uIGZhbWlseSBncmFtbWFycyAocGxhbiBcdTAwQTc1LjNcdTIwMTNcdTAwQTc1LjcpOiBjcC9pbnN0YWxsL212L2dpdCBtdixcbi8vIHJtL2dpdCBybS90cnVuY2F0ZSwgc2VkIC1pIGluLXBsYWNlIGVkaXRzLCBhbmQgcGF0Y2gvZ2l0IGFwcGx5LiBUaGV5IHNoYXJlXG4vLyB0aGUgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlczogbGVhZGluZyBlbnYgYXNzaWdubWVudHMgKHN0cmlwcGVkIGJ5IHRoZSB3YWxrKVxuLy8gYW5kIG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBhcmUgc2tpcHBlZCAobWVjaGFuaWNhbGx5IGNlcnRhaW4pOyBhbnlcbi8vIG90aGVyIHdyYXBwZXIgaXMgdW5yZXNvbHZlZDsgYSBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvblxuLy8gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb247IGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHM7IGdsb2JiZWQgb3IgdmFyaWFibGVcbi8vIHBhdGhzIGFyZSB1bnJlc29sdmVkOyBkaXJlY3Rvcnktc2hhcGVkIHNvdXJjZSBvcGVyYW5kcyBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV3JhcHBlciB3b3JkcyB0aGF0IG9ic2N1cmUgdGhlIHdyYXBwZWQgY29tbWFuZCdzIGFyZ3YgKHBsYW4gXHUwMEE3NSk6IGEgZmFtaWx5IGNvbW1hbmQgYmVoaW5kIG9uZSBpcyB1bnJlc29sdmVkLCBuZXZlciBndWVzc2VkLiAqL1xuY29uc3QgRk9SRUlHTl9XUkFQUEVSUyA9IG5ldyBTZXQoWydzdWRvJywgJ3hhcmdzJywgJ25vaHVwJywgJ3RpbWUnLCAnbmljZScsICdkb2FzJ10pO1xuXG4vKiogQSBsZWFkaW5nIGBOQU1FPXZhbHVlYCBhc3NpZ25tZW50IHRva2VuIChgZW52IEZPTz1iYXIgY3AgYSBiYCBrZWVwcyBvbmUgYWZ0ZXIgdGhlIHdyYXBwZXIgd29yZCkuICovXG5jb25zdCBBU1NJR05NRU5UX1RPS0VOID0gL15bQS1aYS16X11bQS1aYS16MC05X10qPS87XG5cbi8qKlxuICogU3RyaXAgYXQgbW9zdCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgXHUyMDE0IG1lY2hhbmljYWxseSB0cmFuc3BhcmVudCAocGxhblxuICogXHUwMEE3NSkgXHUyMDE0IGFuZCBhbnkgbGVhZGluZyBhc3NpZ25tZW50cyBhZnRlciBpdDogYGVudiBGT089YmFyIGNwIGEgYmAgc2V0cyBGT09cbiAqIHRoZW4gcnVucyBjcCwgZXhhY3RseSB0aGUgdHJhbnNwYXJlbnQtcHJlZml4IGNsYXNzIHRoZSB3YWxrIHN0cmlwcyBiZWZvcmVcbiAqIHRva2VuaXppbmcgKGBGT089YmFyIGVudiBjcCBhIGJgIGFycml2ZXMgaGVyZSB3aXRoIHRoZSBhc3NpZ25tZW50cyBhbHJlYWR5XG4gKiBnb25lKS5cbiAqL1xuZnVuY3Rpb24gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHVud3JhcHBlZCA9IGFyZ3ZbMF0gPT09ICdjb21tYW5kJyB8fCBhcmd2WzBdID09PSAnZW52JyA/IGFyZ3Yuc2xpY2UoMSkgOiBhcmd2O1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdW53cmFwcGVkLmxlbmd0aCAmJiBBU1NJR05NRU5UX1RPS0VOLnRlc3QodW53cmFwcGVkW2ldKSkgaSArPSAxO1xuICByZXR1cm4gaSA+IDAgPyB1bndyYXBwZWQuc2xpY2UoaSkgOiB1bndyYXBwZWQ7XG59XG5cbmZ1bmN0aW9uIHB1c2hVbnJlc29sdmVkKHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIGZpbGVBcmc6IHN0cmluZywgcmVhc29uOiBzdHJpbmcpOiB2b2lkIHtcbiAgcmVzdWx0cy5wdXNoKHsgc3RhdHVzOiAndW5yZXNvbHZlZCcsIGlkaW9tLCBmaWxlQXJnLCByZWFzb24gfSk7XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeSAodGhlIGRlc3QtZGlyIGRlY2lzaW9uLCBwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQ7IGZzIHN0YXQgbGlrZSB0aGUgcmVhZCBpZGlvbXMnIGxpbmUgY291bnRzKS4gKi9cbmZ1bmN0aW9uIGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0RpcmVjdG9yeSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2hhcmVkIGNwL2luc3RhbGwvbXYgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBwZXItZmFtaWx5IG9wdGlvblxuICogc2V0cyBhbmQgdG91Y2ggb3BlcmF0aW9ucyBiZWhpbmQgb25lIHBhcnNlci5cbiAqL1xuaW50ZXJmYWNlIENvcHlNb3ZlU3BlYyB7XG4gIGlkaW9tOiAnY3Atd3JpdGUnIHwgJ2luc3RhbGwtd3JpdGUnIHwgJ212LXdyaXRlJztcbiAgLyoqIEtub3duIG5vLXZhbHVlIGZsYWdzIChjb25zdW1lZCwgbmV2ZXIgb3BlcmFuZHMpLiAqL1xuICBub1ZhbHVlOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKipcbiAgICogTm8tY2xvYmJlciBmbGFncyAoYGNwIC1uYC9gLS1uby1jbG9iYmVyYCk6IGNvbnN1bWVkIGxpa2Ugbm8tdmFsdWUgZmxhZ3MsXG4gICAqIGJ1dCB0aGUgd3JpdGUgc3RpbGwgcGFyc2VzIFx1MjAxNCB0aGUgc2tpcCBpcyBpbnZpc2libGUgdG8gdGhlIHBvc3QtY29tbWFuZFxuICAgKiBieXRlLWNvbXBhcmUgZ2F0ZSwgd2hpY2ggY2Fubm90IGRpc3Rpbmd1aXNoIGEgcmVhbCBjb3B5IGZyb20gYSBwcmUtZXhpc3RpbmdcbiAgICogZXF1YWwgZGVzdCAodGhlIGRvY3VtZW50ZWQgbm8tb3AgcmVzaWR1ZSwgcGlubmVkIGluXG4gICAqIGJhc2gtd3JpdGUtaW50ZWdyYXRpb24udGVzdC50cykuXG4gICAqL1xuICBub0Nsb2JiZXI6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBLbm93biB2YWx1ZS10YWtpbmcgZmxhZ3MgKHRoZSBuZXh0IHdvcmQgaXMgdGhlIHZhbHVlIFx1MjAxNCBgLXQgRElSYCwgb3IgYW4gaW5zdGFsbCBtb2RlL293bmVyL2dyb3VwKS4gKi9cbiAgdmFsdWVUYWtpbmc6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBGbGFncyB0aGF0IGZhaWwgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkIChgY3AgLWJgL2AtLWJhY2t1cGAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGRyeS1ydW4gYC1uYC9gLS1kcnktcnVuYCkuICovXG4gIGV4Y2x1ZGVkOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogVGhlIHBlci1zb3VyY2UgdG91Y2g6IGNwL2luc3RhbGwgcmVhZCB0aGVpciBzb3VyY2VzOyBtdiBkZWxldGVzIHRoZW0uICovXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnIHwgJ2RlbGV0ZSc7XG4gIC8qKiBUaGUgcGVyLWRlc3QgdG91Y2g6IGNwL2luc3RhbGwgb3ZlcndyaXRlOyBtdiByZW5hbWUtY29waWVzLiAqL1xuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfCAncmVuYW1lLWNvcHknO1xufVxuXG5jb25zdCBDUF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnY3Atd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLXInLCAnLVInLCAnLXAnLCAnLWYnLCAnLXYnLCAnLWknLCAnLXUnLCAnLWEnLCAnLWQnLCAnLUwnLCAnLVAnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldChbJy1uJywgJy0tbm8tY2xvYmJlciddKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWInLCAnLS1iYWNrdXAnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IElOU1RBTExfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2luc3RhbGwtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLUQnLCAnLXMnLCAnLXYnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeScsICctbScsICctbycsICctZyddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctZCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgLy8gYG12IC1uYCBzdGF5cyBpbiBub1ZhbHVlLCBub3Qgbm9DbG9iYmVyOiBhbiBtdiBza2lwIGxlYXZlcyB0aGUgc291cmNlIGluXG4gIC8vIHBsYWNlLCBhbmQgdGhlIGRlbGV0ZSdzIG93biBhYnNlbmNlIGdhdGUgdGhlbiBmYWlscyB0aGUgdG91Y2ggXHUyMDE0IHRoZVxuICAvLyBuby1jbG9iYmVyIGJsaW5kIHNwb3QgaXMgY3AncyBieXRlLWNvbXBhcmUsIG5vdCBtdidzLlxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLW4nLCAnLXYnLCAnLXUnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoKSxcbiAgc291cmNlT3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgZGVzdE9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5J1xufTtcblxuY29uc3QgR0lUX01WX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdtdi13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaycsICctdiddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KCksXG4gIC8vIGBnaXQgbXYgLW5gL2AtLWRyeS1ydW5gIGlzIGEgdHJpYWwgcnVuIHRoYXQgbW92ZXMgbm90aGluZyAodGhlIHNhbWVcbiAgLy8gcmVhZC1vbmx5IGNsYXNzIGFzIGBwYXRjaCAtLWRyeS1ydW5gLCBwbGFuIFx1MDBBNzUuNykgXHUyMDE0IGZhaWwgY2xvc2VkLlxuICBleGNsdWRlZDogbmV3IFNldChbJy1uJywgJy0tZHJ5LXJ1biddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgZGVzdE9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5J1xufTtcblxuaW50ZXJmYWNlIENvcHlNb3ZlUGFydHMge1xuICAvKiogT3BlcmFuZHMgaW4gb3JkZXIgKHNvdXJjZXM7IGluIHRoZSBub24tYC10YCBmb3JtIHRoZSBsYXN0IGlzIHRoZSBkZXN0KS4gKi9cbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xuICAvKiogVGhlIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeWAgdmFsdWUsIG9yIG51bGwuICovXG4gIHRhcmdldERpcjogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBQYXJzZSB0aGUgb3BlcmFuZHMgb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQ6IGtub3duIG9wdGlvbnMgYXJlIGNvbnN1bWVkLFxuICogYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kcywgYW5kIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeVs9RElSXWAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIG5leHQgd29yZCBpcyB0aGUgdGFyZ2V0IGRpcmVjdG9yeSwgbmV2ZXIgYSBzb3VyY2UuIEFcbiAqIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChub1xuICogdG91Y2gpLiBSZXR1cm5zIG51bGwgd2hlbiBhIGZhaWwtY2xvc2VkIG9wdGlvbiBpcyBwcmVzZW50IG9yIGEgdmFsdWUtdGFraW5nXG4gKiBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzLlxuICovXG5mdW5jdGlvbiBjb3B5TW92ZVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBzcGVjOiBDb3B5TW92ZVNwZWMpOiBDb3B5TW92ZVBhcnRzIHwgbnVsbCB7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGkgPSAwO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXQnIHx8IGEgPT09ICctLXRhcmdldC1kaXJlY3RvcnknKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIHRhcmdldERpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS10YXJnZXQtZGlyZWN0b3J5PScpKSB7XG4gICAgICB0YXJnZXREaXIgPSBhLnNsaWNlKCctLXRhcmdldC1kaXJlY3Rvcnk9Jy5sZW5ndGgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLmV4Y2x1ZGVkLmhhcyhhKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHNwZWMudmFsdWVUYWtpbmcuaGFzKGEpKSB7XG4gICAgICBpZiAoYXJnc1tpICsgMV0gPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMubm9WYWx1ZS5oYXMoYSkgfHwgc3BlYy5ub0Nsb2JiZXIuaGFzKGEpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHsgb3BlcmFuZHMsIHRhcmdldERpciB9O1xufVxuXG4vKipcbiAqIFRoZSBwZXItc291cmNlIHRvdWNoIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kLiBjcC9pbnN0YWxsIHNvdXJjZXMgYXJlXG4gKiB3aG9sZS1maWxlIHJlYWRzIHJlc29sdmVkIGFnYWluc3QgZnMgbGlrZSB0aGUgcmVhZCBpZGlvbXM7IGEgc291cmNlIHdob3NlXG4gKiBsaW5lIGNvdW50IGNhbm5vdCBiZSByZWFkIGF0IHBhcnNlIHRpbWUgKG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBcdTIwMTQgdGhlIHBhcnNlXG4gKiBydW5zIHBvc3QtY29tbWFuZCwgc28gYSBzb3VyY2UgdGhlIGNvbXBvdW5kJ3Mgb3duIGVhcmxpZXIgYHJtYCBkZWxldGVkIGlzXG4gKiBleGFjdGx5IHRoaXMpIHN0aWxsIHJlc29sdmVzIGFzIGEgcmFuZ2UtbGVzcyB3aG9sZS1maWxlIHJlYWQ6IHRoZSBkcml2ZXJcbiAqIHBhaXJzIHRoZSBkZXN0aW5hdGlvbiBhZ2FpbnN0IGl0LCBzbyB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwbGFuIFx1MDBBNzMgc3RlcFxuICogMWIpIGFuZCB0aGUgcmVhZCdzIHBvc3QtY29tbWFuZCBleGlzdGVuY2UgZ2F0ZSBhcHBseSBcdTIwMTQgYW4gdW5leHBsYWluZWRcbiAqIGFic2VuY2UgZmFpbHMgdGhlIGNvcHkgZGVjaXNpdmVseSBhbmQgYSBwaGFudG9tIHNvdXJjZSBuZXZlciBmaXJlcyB0aGVcbiAqIGRlc3QuIFRoZSBtdiBzb3VyY2UgaXMgYSBkZWxldGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRTb3VyY2VTcGFuKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgc3BlYzogQ29weU1vdmVTcGVjLFxuICBhYnNvbHV0ZVBhdGg6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKHNwZWMuc291cmNlT3BlcmF0aW9uID09PSAnZGVsZXRlJykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnZGVsZXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSwgKCkgPT4gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgIHNwYW46XG4gICAgICByYW5nZSA9PT0gbnVsbFxuICAgICAgICA/IHsgb3BlcmF0aW9uOiAncmVhZCcsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgICAgIGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LFxuICAgICAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW5cbiAgICAgICAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBjcC9pbnN0YWxsL212IGZhbWlseSAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogb3BlcmFuZHMgcmVzb2x2ZSB0byBzb3VyY2UvZGVzdFxuICogcGFpcnMgXHUyMDE0IGVhY2ggc291cmNlIGlzIGEgcmVhZCAoY3AvaW5zdGFsbCkgb3IgZGVsZXRlIChtdiksIGVhY2ggZGVzdCBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIChjcC9pbnN0YWxsKSBvciByZW5hbWUtY29weSAobXYpLCBzb3VyY2VzIGJlZm9yZSBkZXN0cyBpblxuICogZGVjbGFyYXRpb24gb3JkZXIuIEEgZGVzdCB0aGF0IGVuZHMgaW4gYC9gIG9yIHN0YXRzIGFzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeVxuICogbWFwcyB0byBgZGlyL2Jhc2VuYW1lKHNvdXJjZSlgIHBlciBzb3VyY2U7IGAtdCBESVJgL2AtLXRhcmdldC1kaXJlY3Rvcnk9RElSYFxuICogbWFwcyB0aGUgc2FtZSB3YXkgYW5kIGlzIHVucmVzb2x2ZWQgd2hlbiBpdHMgdmFsdWUgaXMgbm90IGRpcmVjdG9yeS1zaGFwZWQuXG4gKiBNdWx0aS1zb3VyY2UgY29tbWFuZHMgbmVlZCBhIGRpcmVjdG9yeSBkZXN0OyBhIGRpcmVjdG9yeS1zaGFwZWQgb3JcbiAqIGdsb2JiZWQvdmFyaWFibGUgc291cmNlLCBhIGdsb2JiZWQvdmFyaWFibGUgZGVzdCwgb3IgYSBmYWlsLWNsb3NlZCBvcHRpb25cbiAqIChgY3AgLWJgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBgLW5gKSBlbWl0cyBubyB0b3VjaGVzLlxuICovXG5mdW5jdGlvbiBtYXRjaENvcHlNb3ZlRmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBzcGVjOiBDb3B5TW92ZVNwZWMgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdID0gW107XG4gIGxldCBkaXIgPSBkaXJGb3JSZXNvbHV0aW9uO1xuICBpZiAoY29tbWFuZCA9PT0gJ2NwJyB8fCBjb21tYW5kID09PSAnaW5zdGFsbCcgfHwgY29tbWFuZCA9PT0gJ212Jykge1xuICAgIHNwZWMgPSBjb21tYW5kID09PSAnY3AnID8gQ1BfU1BFQyA6IGNvbW1hbmQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IE1WX1NQRUM7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAnbXYnKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ212LXdyaXRlJywgJ212JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzcGVjID0gR0lUX01WX1NQRUM7XG4gICAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgICBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIH1cbiAgfSBlbHNlIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIC8vIEEgd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCBmYWlsIGNsb3NlZCByYXRoZXIgdGhhbiBtaXMtcGFyc2UuXG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgY29uc3Qgd3JhcHBlZFNwZWMgPVxuICAgICAgd3JhcHBlZCA9PT0gJ2NwJyA/IENQX1NQRUMgOiB3cmFwcGVkID09PSAnaW5zdGFsbCcgPyBJTlNUQUxMX1NQRUMgOiB3cmFwcGVkID09PSAnbXYnID8gTVZfU1BFQyA6IG51bGw7XG4gICAgaWYgKHdyYXBwZWRTcGVjICE9PSBudWxsKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCB3cmFwcGVkU3BlYy5pZGlvbSwgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHNwZWMgPT09IG51bGwpIHJldHVybjtcblxuICBjb25zdCBwYXJ0cyA9IGNvcHlNb3ZlUGFydHMoYXJncywgc3BlYyk7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCB8fCBwYXJ0cy5vcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAvLyBSZXNvbHZlIGV2ZXJ5IHNvdXJjZSBiZWZvcmUgZW1pdHRpbmcgYW55dGhpbmc6IGEgZGlyZWN0b3J5LXNoYXBlZCxcbiAgLy8gZ2xvYmJlZCwgb3IgdmFyaWFibGUgc291cmNlIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAodGhlIGRlc3RcbiAgLy8gbWFwcGluZyBpcyBwZXItc291cmNlLCBzbyBhbiB1bmtub3dhYmxlIHNvdXJjZSBtYWtlcyB0aGUgZGVzdHMgdW5rbm93YWJsZSkuXG4gIGNvbnN0IHNvdXJjZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNvdXJjZSBvZiBwYXJ0cy5vcGVyYW5kcy5zbGljZSgwLCBwYXJ0cy50YXJnZXREaXIgPT09IG51bGwgPyAtMSA6IHVuZGVmaW5lZCkpIHtcbiAgICBpZiAoc291cmNlLmVuZHNXaXRoKCcvJykpIHJldHVybjtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsIHNwZWMuaWRpb20sIHNvdXJjZSwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkgcmV0dXJuO1xuICAgIHNvdXJjZVBhdGhzLnB1c2goYWJzb2x1dGVQYXRoKTtcbiAgfVxuICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgbGV0IGRlc3RQYXRoczogc3RyaW5nW107XG4gIGlmIChwYXJ0cy50YXJnZXREaXIgIT09IG51bGwpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUocGFydHMudGFyZ2V0RGlyKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgcGFydHMudGFyZ2V0RGlyLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFwYXJ0cy50YXJnZXREaXIuZW5kc1dpdGgoJy8nKSAmJiAhaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcikpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICd0aGUgLXQgdGFyZ2V0IGlzIG5vdCBhbiBleGlzdGluZyBkaXJlY3RvcnknKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBwYXJ0cy50YXJnZXREaXIpO1xuICAgIGRlc3RQYXRocyA9IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgodGFyZ2V0QWJzLCBiYXNlbmFtZShwKSkpO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGRlc3QgPSBwYXJ0cy5vcGVyYW5kc1twYXJ0cy5vcGVyYW5kcy5sZW5ndGggLSAxXTtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZGVzdCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkZXN0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBkZXN0KTtcbiAgICBjb25zdCBkZXN0SXNEaXIgPSBkZXN0LmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShkZXN0QWJzKTtcbiAgICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID4gMSAmJiAhZGVzdElzRGlyKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBkZXN0LCAnYSBtdWx0aS1zb3VyY2UgY29weS9tb3ZlIG5lZWRzIGEgZGlyZWN0b3J5IGRlc3RpbmF0aW9uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGRlc3RQYXRocyA9IGRlc3RJc0RpciA/IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgoZGVzdEFicywgYmFzZW5hbWUocCkpKSA6IFtkZXN0QWJzXTtcbiAgfVxuXG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICBlbWl0U291cmNlU3BhbihyZXN1bHRzLCBzcGVjLCBzb3VyY2VQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxuICBmb3IgKGxldCBrID0gMDsgayA8IHNvdXJjZVBhdGhzLmxlbmd0aDsgaysrKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246IHNwZWMuZGVzdE9wZXJhdGlvbiwgYWJzb2x1dGVQYXRoOiBkZXN0UGF0aHNba10sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuY29uc3QgUk1fTk9fVkFMVUUgPSBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLXYnXSk7XG4vKiogYHJtYC9gZ2l0IHJtYCBmbGFncyB3aG9zZSBzZW1hbnRpY3MgYXJlIG91dCBvZiBzY29wZTogcmVjdXJzaXZlIHJlbW92YWwgYW5kIHJtZGlyLiAqL1xuY29uc3QgUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnXSk7XG4vKiogYGdpdCBybWAgYWRkcyB0aGUgZHJ5LXJ1biBmb3JtIHRvIHRoZSBleGNsdXNpb25zLiAqL1xuY29uc3QgR0lUX1JNX0VYQ0xVREVEID0gbmV3IFNldChbJy1yJywgJy1SJywgJy0tcmVjdXJzaXZlJywgJy1kJywgJy1uJywgJy0tZHJ5LXJ1biddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJtL2dpdCBybSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYSByZWN1cnNpdmUvcm1kaXIgZmxhZyAob3JcbiAqIGAtLWNhY2hlZGAgZm9yIGdpdCBybSBcdTIwMTQgdGhlIHdvcmt0cmVlIGZpbGUgc3Vydml2ZXMpIGV4Y2x1ZGVzIHRoZSB3aG9sZVxuICogY29tbWFuZDsgZWFjaCByZW1haW5pbmcgZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIGRlbGV0ZSwgYW5kIGFcbiAqIGRpcmVjdG9yeS1zaGFwZWQgb3BlcmFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUm1PcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGV4Y2x1ZGVkOiBSZWFkb25seVNldDxzdHJpbmc+LFxuICBleGNsdWRlQ2FjaGVkOiBib29sZWFuLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZXhjbHVkZWQuaGFzKGEpIHx8IChleGNsdWRlQ2FjaGVkICYmIGEgPT09ICctLWNhY2hlZCcpKSByZXR1cm47XG4gICAgaWYgKFJNX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncm0td3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGF0aWNhbGx5IGV2YWx1YXRlIGFuIGFic29sdXRlIGB0cnVuY2F0ZSAtc2Agc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiBhIHBsYWluXG4gKiBpbnRlZ2VyIHdpdGggYW4gb3B0aW9uYWwgSy9NL0cgc3VmZml4LiBSZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSxcbiAqIGAtciByZWZgIHZhbHVlcywgYW5kIHNoZWxsLWV4cGFuZGVkIHZhbHVlcyBkZXBlbmQgb24gcnVudGltZSBzdGF0ZSBcdTIxOTJcbiAqIHVuZGVmaW5lZCAodGhvc2Ugc3BhbnMgZ2F0ZSBleGlzdGVuY2Utb25seSkuXG4gKi9cbmZ1bmN0aW9uIGV2YWx1YXRlU3RhdGljU2l6ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IG0gPSB2YWx1ZS5tYXRjaCgvXihcXGQrKShbS01HXSk/JC8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYmFzZSA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gIGNvbnN0IG11bHQgPSBtWzJdID09PSAnSycgPyAxMDI0IDogbVsyXSA9PT0gJ00nID8gMTAyNCAqKiAyIDogbVsyXSA9PT0gJ0cnID8gMTAyNCAqKiAzIDogMTtcbiAgcmV0dXJuIGJhc2UgKiBtdWx0O1xufVxuXG4vKipcbiAqIFRoZSB0cnVuY2F0ZSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNSk6IGAtcyBTSVpFYC9gLXIgcmVmYCBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGVcbiAqIHNpemUgdmFsdWUgbWF5IGl0c2VsZiBsZWFkIHdpdGggYC1gIChgdHJ1bmNhdGUgLXMgLTEwIGZgKSBcdTIwMTQgYW5kIGAtY2AgaXNcbiAqIGNvbXBhdGlibGUuIFdpdGhvdXQgYC1zYC9gLXJgIHRoZSBjb21tYW5kIGNoYW5nZXMgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guIEVhY2hcbiAqIGZpbGUtc2hhcGVkIG9wZXJhbmQgaXMgYSB0cnVuY2F0ZTsgYW4gYWJzb2x1dGUgYC1zIE5gIGNhcnJpZXMgdGhlIHN0YXRpY2FsbHlcbiAqIGV2YWx1YXRlZCBzaXplIG9uIHRoZSBzcGFuICh0aGUgXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50LFxuICogYC1zIDBgIFx1MjE5MiBlbXB0eSksIHJlbGF0aXZlIHNpemVzIGFuZCBgLXIgcmVmYCBzdGF5IGV4aXN0ZW5jZS1vbmx5LlxuICovXG5mdW5jdGlvbiBtYXRjaFRydW5jYXRlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzYXdTaXplRmxhZyA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBsZXQgc3RhdGljU2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkO1xuICBjb25zdCBvcGVyYW5kczogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IHNpemU6IG51bWJlciB8IHVuZGVmaW5lZCB9PiA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnKSB7XG4gICAgICBzYXdTaXplRmxhZyA9IHRydWU7XG4gICAgICBzdGF0aWNTaXplID0gZXZhbHVhdGVTdGF0aWNTaXplKGFyZ3NbaSArIDFdKTtcbiAgICAgIGkgKz0gMTsgLy8gY29uc3VtZSB0aGUgc2l6ZSB2YWx1ZSwgZXZlbiB3aGVuIGl0IGxlYWRzIHdpdGggYC1gXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcicpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSB1bmRlZmluZWQ7IC8vIHRoZSBsYXN0IHNpemUgb3B0aW9uIHdpbnM7IGEgcmVmIGhhcyBubyBzdGF0aWMgdmFsdWVcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gIH1cbiAgaWYgKCFzYXdTaXplRmxhZykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZC5wYXRoKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3RydW5jYXRlLWNvbW1hbmQnLCBvcGVyYW5kLnBhdGgsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLnBhdGguZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZC5wYXRoKSkpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3RydW5jYXRlLWNvbW1hbmQnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICd0cnVuY2F0ZScsXG4gICAgICAgIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLihvcGVyYW5kLnNpemUgIT09IHVuZGVmaW5lZCA/IHsgc2l6ZTogb3BlcmFuZC5zaXplIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBybS9naXQgcm0vdHJ1bmNhdGUgZmFtaWx5IChwbGFuIFx1MDBBNzUuNSk6IGBybWAvYGdpdCBybWAgb3BlcmFuZHMgYXJlXG4gKiBkZWxldGVzLCBgdHJ1bmNhdGVgIG9wZXJhbmRzIGFyZSB0cnVuY2F0aW9ucyAob25seSB3aGVuIGAtc2AvYC1yYCBpc1xuICogcHJlc2VudCkuIGBnaXQgcm0gLS1jYWNoZWRgIHRvdWNoZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbVRydW5jYXRlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncm0nKSB7XG4gICAgbWF0Y2hSbU9wZXJhbmRzKHJlc3Quc2xpY2UoMSksIFJNX0VYQ0xVREVELCBmYWxzZSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICBtYXRjaFRydW5jYXRlT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiAhPT0gbnVsbCAmJiBzdWIuc3ViY29tbWFuZCA9PT0gJ3JtJykge1xuICAgICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsICdybScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbWF0Y2hSbU9wZXJhbmRzKFxuICAgICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgICAgR0lUX1JNX0VYQ0xVREVELFxuICAgICAgICB0cnVlLFxuICAgICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIHJlc3VsdHNcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3JtJyB8fCB3cmFwcGVkID09PSAndHJ1bmNhdGUnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3JtJyA/ICdybS13cml0ZScgOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGJvZHkgb2YgYW4gdW5xdW90ZWQgaGVyZWRvYyBpcyBzaGVsbC1saXRlcmFsLiBUaGUgc2hlbGwgZXhwYW5kc1xuICogYCRgIGFuZCBiYWNrdGljayBzdWJzdGl0dXRpb25zIGFuZCBwcm9jZXNzZXMgYmFja3NsYXNoIGVzY2FwZXMgKGBcXCRgLCBgYCBcXGAgYGAsXG4gKiBgXFxcXGAsIGJhY2tzbGFzaC1uZXdsaW5lKSBpbiBhbiB1bnF1b3RlZCBib2R5IGJlZm9yZSB0aGUgaG9zdCByZWFkcyBpdDsgYVxuICogYmFyZSBiYWNrc2xhc2ggYmVmb3JlIGFueSBvdGhlciBjaGFyIHN1cnZpdmVzIGxpdGVyYWxseS4gQSBxdW90ZWQgZGVsaW1pdGVyXG4gKiBtYWtlcyB0aGUgYm9keSBsaXRlcmFsIHJlZ2FyZGxlc3MgXHUyMDE0IGNoZWNrZWQgYnkgdGhlIGNhbGxlci5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0JvZHlJc0xpdGVyYWwoYm9keTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChib2R5LmluY2x1ZGVzKCckJykgfHwgYm9keS5pbmNsdWRlcygnYCcpKSByZXR1cm4gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYm9keS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChib2R5W2ldICE9PSAnXFxcXCcpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG5leHQgPSBib2R5W2kgKyAxXTtcbiAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQgPT09ICckJyB8fCBuZXh0ID09PSAnYCcgfHwgbmV4dCA9PT0gJ1xcXFwnIHx8IG5leHQgPT09ICdcXG4nKSByZXR1cm4gZmFsc2U7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHdyaXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4yKSBmb3IgdGhlIGhvc3QgZmFtaWxpZXMgd2hvc2UgYm9kaWVzIGFyZVxuICogY29udGVudDogYGNhdGAgKGJvZHkgXHUyMTkyIHRoZSBjb250ZW50IHJlZGlyZWN0cyksIGB0ZWVgIChib2R5IFx1MjE5MiB0aGUgb3BlcmFuZHMpLFxuICogYW5kIGBwYXRjaGAvYGdpdCBhcHBseWAgKGJvZHkgXHUyMTkyIHBhdGNoIHRleHQsIFx1MDBBNzUuNykuIEFueSBvdGhlciBob3N0J3MgaGVyZWRvY1xuICogYm9keSBpcyBub3QgYXR0cmlidXRhYmxlIGNvbnRlbnQgXHUyMDE0IHN0ZGluLW9ubHkgYW5kIG5vbi1mYW1pbHkgY29tbWFuZHNcbiAqIChgcHl0aG9uMyAtIDw8RU9GID4gb3V0YCwgYGxzID4gb3V0IDw8RU9GYCkgZ2V0IG5vIHdyaXRlIHRvdWNoLCBhbmRcbiAqIHJlYWQtZmFtaWx5IGNvbW1hbmRzIChgc2VkIC1uICcxLDJwJyA8PEVPRmApIGZhbGwgdGhyb3VnaCB0byB0aGUgcmVhZFxuICogbWF0Y2hlcnMuIEVtcHR5IGA+PmAtYm9kaWVzIGFwcGVuZCBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nOyBlbXB0eSBgPmAtYm9kaWVzXG4gKiB0cnVuY2F0ZSAod2hvbGUtZmlsZSwgdGhlIEYyIHJ1bGUpLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBgPj5gIGFwcGVuZHMgYW5kIGA+YCBvdmVyd3JpdGVzIHRocmVhZCB0aGUgYm9keSB3aGVuIHRoZVxuICogY29udGVudCByZWRpcmVjdCBpcyBzaW5nbGUgYW5kIHBsYWluIFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCBvbiB0aGVcbiAqIG92ZXJ3cml0ZSAodGhlIHRyYWlsaW5nIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcyBpcyByZXN0b3JlZCwgc2luY2UgdGhlXG4gKiBnYXRlIGNvbXBhcmVzIGZ1bGwgZmlsZSBieXRlcyksIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZCAocGxhblxuICogXHUwMEE3MyBzdGVwIDFiIGxpc3RzIFwidGVlL2hlcmVkb2Mgd2l0aCBhIGxpdGVyYWwgYm9keVwiIGluIHRoZSBleGFjdCBjbGFzcykuXG4gKiBBbiB1bnF1b3RlZCBkZWxpbWl0ZXIgbGV0cyB0aGUgc2hlbGwgZXhwYW5kIHRoZSBib2R5IGJlZm9yZSB0aGUgaG9zdCByZWFkc1xuICogaXQsIHNvIG9ubHkgYSBsaXRlcmFsIGJvZHkgKG5vIGAkYCwgYmFja3RpY2ssIG9yIHNoZWxsLXByb2Nlc3NlZCBiYWNrc2xhc2gpXG4gKiB0aHJlYWRzIFx1MjAxNCBhbiBleHBhbmRhYmxlIG9uZSBkZWdyYWRlcyB0byB0aGUgZXhpc3RlbmNlLWdhdGVkIGFkdmlzb3J5IGNsYXNzXG4gKiByYXRoZXIgdGhhbiByaXNrIGEgZGVjaXNpdmUtZmFpbCBvbiBjb250ZW50IHRoYXQgbmV2ZXIgcmVhY2hlZCB0aGUgZmlsZS5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlIZXJlZG9jT3BlbmVyKFxuICBvcGVuZXI6IHN0cmluZyxcbiAgYm9keTogc3RyaW5nLFxuICBxdW90ZWREZWxpbTogYm9vbGVhbixcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgYm9keUxpdGVyYWwgPSBxdW90ZWREZWxpbSB8fCBoZXJlZG9jQm9keUlzTGl0ZXJhbChib2R5KTtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMob3BlbmVyKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG5cbiAgY29uc3QgZW1pdENvbnRlbnRSZWRpcmVjdHMgPSAoKTogdm9pZCA9PiB7XG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluQXBwZW5kICYmIHIub3AgPT09ICc+PicgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGJvZHkgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICA/IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgLy8gVGhlIGV4YWN0IGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzLCBzbyB0aGUgdHJhaWxpbmdcbiAgICAgICAgICAgICAgICAgIC8vIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcGVkIGNvbWVzIGJhY2sgb24gdGhlIG92ZXJ3cml0ZS5cbiAgICAgICAgICAgICAgICAgIC4uLihzaW5nbGVQbGFpbk92ZXJ3cml0ZSAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBpZiAoaG9zdCA9PT0gJ2NhdCcpIHtcbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgICBpZiAocGFydHMgIT09IG51bGwpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBpZiAocGFydHMuYXBwZW5kKSB7XG4gICAgICAgICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgICBzcGFuOlxuICAgICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgICAvLyBTYW1lIHJlc3RvcmVkLWBcXG5gIGV4YWN0IGJvZHkgYXMgdGhlIHJlZGlyZWN0IGJyYW5jaDsgYVxuICAgICAgICAgICAgICAgICAgICAvLyB0ZWUgb3BlcmFuZCB3aXRoIGEgY29udGVudCByZWRpcmVjdCBwcmVzZW50IGtlZXBzIHRoZVxuICAgICAgICAgICAgICAgICAgICAvLyByZWRpcmVjdCdzIHRocmVhZGluZyBvbmx5IChtaXJyb3Igb2YgdGhlIGFwcGVuZCBicmFuY2gpLlxuICAgICAgICAgICAgICAgICAgICAuLi4oY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDAgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGAke2JvZHl9XFxuYCB9IDoge30pXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgZW1pdENvbnRlbnRSZWRpcmVjdHMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwYXRjaCcgfHwgaG9zdCA9PT0gJ2dpdCcpIHtcbiAgICBjbGFzc2lmeVBhdGNoSGVyZWRvYyhhcmd2LCBib2R5LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBOb24tZmFtaWx5IGhvc3Q6IHRoZSBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgbm8gd3JpdGUgdG91Y2guXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHNlZCAtaSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNiksIHRoZSBmaXJzdCBjb25zdW1lciBvZiBleGFjdCByYW5nZXM6IGFcbi8vIHN1YnN0aXR1dGlvbi1vbmx5IHNjcmlwdCB3aXRoIG51bWVyaWMgYWRkcmVzc2VzIG1vZGlmaWVzIHRoZSBhZGRyZXNzZWRcbi8vIGxpbmVzOyBhbnl0aGluZyBsZXNzIHN0YXRpY2FsbHkgY2VydGFpbiBpcyBhIHdob2xlLWZpbGUgbW9kaWZ5LiBUaGVcbi8vIHN1ZmZpeC9zY3JpcHQgZGlzYW1iaWd1YXRpb24gYW5kIHRoZSBzZWdtZW50IGNsYXNzaWZpY2F0aW9uIGJlbG93IGFyZSB0aGVcbi8vIHdob2xlIG9mIGl0IFx1MjAxNCBldmVyeXRoaW5nIGVsc2UgZm9sbG93cyB0aGUgc2hhcmVkIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXMuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9uIHNlZ21lbnQgKGBOYCwgYE4sTWApIFx1MjAxNCB0aGUgb25seSBmb3JtIHdpdGggYW4gZXhhY3QgcmFuZ2UuICovXG5jb25zdCBOVU1FUklDX1NVQlNUSVRVVElPTiA9IC9eKFxcZCspKD86LChcXGQrKSk/W3N5XS87XG5cbi8qKiBBbiB1bmFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCBcdTIwMTQgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCB3aG9sZSBmaWxlIGFkZHJlc3NlZC4gKi9cbmNvbnN0IFVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04gPSAvXltzeV0vO1xuXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdzZWQnKSB7XG4gICAgbWF0Y2hTZWRJbnBsYWNlQXJncyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3NlZCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2VkIC1pIG9wZXJhbmQgZ3JhbW1hcjogYC1pYCBiYXJlLCBgLWlTVUZGSVhgIGF0dGFjaGVkLCBvciBhIHNlcGFyYXRlXG4gKiBzdWZmaXggd29yZCByZXNvbHZlZCBieSB0aGUgc3RhbmRhcmQgZGlzYW1iaWd1YXRpb24gXHUyMDE0IHRoZSB3b3JkIGFmdGVyIGAtaWBcbiAqIGlzIHRoZSBzdWZmaXggb25seSB3aGVuIGl0IGRvZXMgbm90IHN0YXJ0IHdpdGggYC1gLCBpcyBub3Qgc2NyaXB0LXNoYXBlZFxuICogKGEgc2VkIGNvbW1hbmQgbGV0dGVyIG9yIGFuIGFkZHJlc3Mgc3RhcnQgXHUyMDE0IGBzL2EvYi9gLCBgMmRgLCBgL3gvZGApLCBhbmQgYVxuICogc2NyaXB0IHBsdXMgYXQgbGVhc3Qgb25lIGZpbGUgb3BlcmFuZCBzdGlsbCBmb2xsb3cgaXQgKHRoZSBCU0RcbiAqIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOyBHTlUncyBhdHRhY2hlZC1vbmx5IHJlYWRpbmcgb3RoZXJ3aXNlKS4gQVxuICogc2NyaXB0LXNoYXBlZCB3b3JkIGlzIHRoZSBzY3JpcHQgdW5kZXIgR05VJ3MgcmVhZGluZzogYHNlZCAtaSBzL2EvYi8gZiBnYFxuICogd291bGQgb3RoZXJ3aXNlIHN0ZWFsIHRoZSBmaXJzdCBmaWxlIG9wZXJhbmQgYXMgYSBzdWZmaXggYW5kIHNpbGVudGx5IG1pc3NcbiAqIGl0cyB3cml0ZSAodGhlIG11bHRpLWZpbGUtc2VkIG1pc3BhcnNlKS4gQW4gYXR0YWNoZWQgb3IgZGlzYW1iaWd1YXRlZFxuICogc3VmZml4IGlzIGEgYmFja3VwOiBhIG5vbi1lbXB0eSBzdWZmaXggZW1pdHMgYW4gYWRkaXRpb25hbCBjcmVhdGUtb3ZlcndyaXRlXG4gKiB0b3VjaCBvbiBgPGZpbGU+PFNVRkZJWD5gOyBhbiBlbXB0eSBzdWZmaXggKHdoaWNoIHRoZSBxdW90ZS1hd2FyZSB0b2tlbml6ZXJcbiAqIGRyb3BzIGVudGlyZWx5IFx1MjAxNCBgc2VkIC1pICcnIGZgIGFuZCBgc2VkIC1pIGZgIHRva2VuaXplIGFsaWtlKSBjcmVhdGVzIG5vXG4gKiBiYWNrdXAuXG4gKlxuICogVGhlIHNjcmlwdCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IHBsdXMgZXZlcnkgYC1lYCBhcmd1bWVudCwgc3BsaXQgb24gYDtgLlxuICogU2VnbWVudHMgdGhhdCBhcmUgYWxsIG51bWVyaWMtYWRkcmVzc2VkIHN1YnN0aXR1dGlvbnMgeWllbGQgdGhlIGV4YWN0IHJhbmdlXG4gKiBbbWluIHN0YXJ0LCBtaW4obWF4IGVuZCwgRU9GKV0gKHBlciBmaWxlLCBFT0YgZnJvbSB0aGUgcG9zdC1lZGl0IGNvdW50KTtcbiAqIHNlZ21lbnRzIHRoYXQgYXJlIGFsbCBzdWJzdGl0dXRpb25zIFx1MjAxNCBhbnkgbnVtZXJpYy91bmFkZHJlc3NlZCBtaXggXHUyMDE0IGFyZVxuICogc3RpbGwgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCBzbyB0aGUgd2hvbGUgZmlsZSBpcyBhZGRyZXNzZWQgKFsxLCBFT0ZdKTtcbiAqIGFueSBjb3VudC1jaGFuZ2luZywgcGF0dGVybi1hZGRyZXNzZWQsIHN0ZXAsIG9yIGAkYC1hZGRyZXNzZWQgc2VnbWVudCBpcyBhXG4gKiB3aG9sZS1maWxlIG1vZGlmeSB3aXRoIG5vIHJhbmdlLiBBbiBhYnNlbnQgc2NyaXB0IChubyBzY3JpcHQgYXJndW1lbnQsIG5vXG4gKiBgLWVgKSBpcyB1bnJlc29sdmVkLlxuICovXG4vKipcbiAqIEEgd29yZCB0aGF0IGNhbiBvbmx5IGJlIGEgc2VkIHNjcmlwdCwgbmV2ZXIgYSBCU0Qgc2VwYXJhdGUgc3VmZml4OiBhIHNlZFxuICogY29tbWFuZCBsZXR0ZXIgKGBzYC9geWAvYGRgL1x1MjAyNiksIG9yIGFuIGFkZHJlc3Mgc3RhcnQgKGRpZ2l0LCBgL2AsIGBcXGAsIGAkYCxcbiAqIGB+YCkuIFRoZSBtdWx0aS1maWxlIGZvcm0gYHNlZCAtaSBzL2EvYi8gZiBnYCBwdXRzIHRoZSBzY3JpcHQgaW1tZWRpYXRlbHlcbiAqIGFmdGVyIGJhcmUgYC1pYCAoR05VJ3MgcmVhZGluZzsgdGhlIEJTRCByZWFkaW5nIG5lZWRzIGEgc2VwYXJhdGUgc3VmZml4XG4gKiB3b3JkIGZpcnN0LCBhbmQgYSBsZXR0ZXItbGVhZGluZyBvciBhZGRyZXNzLWxlYWRpbmcgd29yZCBpcyBub3Qgb25lKS5cbiAqL1xuY29uc3QgU0VEX1NDUklQVF9TSEFQRSA9IC9eKD86W0EtWmEtel18XFxkfFxcL3xcXFxcfFxcJHx+KS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZUFyZ3MoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzdWZmaXg6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc2F3SW5wbGFjZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IGVTY3JpcHRzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBUaGUgc2NyaXB0L2ZpbGUgc3BsaXQgb2YgdGhlIHBvc2l0aW9uYWxzIGlzIGRlcml2ZWQgYWZ0ZXIgdGhlIHNjYW46IHRoZVxuICAvLyBmaXJzdCBwb3NpdGlvbmFsIGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgb25seSB3aGVuIG5vIGAtZWAgc2NyaXB0IGV4aXN0cyBcdTIwMTRcbiAgLy8gd2l0aCBgLWVgIHByZXNlbnQgZXZlcnkgcG9zaXRpb25hbCBpcyBhIGZpbGUgKEdOVSBzZWQgcmVhZHMgdGhlIHNjcmlwdFxuICAvLyBmcm9tIGAtZWAgdGhlbiwgbm90IGZyb20gdGhlIGZpcnN0IHBvc2l0aW9uYWwpLlxuICBjb25zdCBwb3NpdGlvbmFsczogc3RyaW5nW10gPSBbXTtcbiAgLy8gRmlsZXMgcHVzaGVkIG91dHNpZGUgdGhlIHBvc2l0aW9uYWwgcGF0aDogYHNlZCAtaSBmYCAoc2NyaXB0IGFic2VudCkuXG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuXG4gIHdoaWxlIChpIDwgYXJncy5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1lJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBhLCAndGhlIC1lIGZsYWcgaXMgbGVmdCB2YWx1ZWxlc3MnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZVNjcmlwdHMucHVzaCh2KTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1pJykge1xuICAgICAgc2F3SW5wbGFjZSA9IHRydWU7XG4gICAgICBjb25zdCB3ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIGBzZWQgLWlgIHdpdGggbm90aGluZyBhZnRlcjogbm8gc3VmZml4LCBubyBzY3JpcHQgXHUyMDE0IHRoZSBhYnNlbnQtc2NyaXB0XG4gICAgICAgIC8vIGNoZWNrIGJlbG93IHJlc29sdmVzIHRoaXMgdW5yZXNvbHZlZC5cbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICh3LnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgICAvLyBUaGUgd29yZCBhZnRlciAtaSBpcyBhbiBvcHRpb24sIG5ldmVyIGEgc3VmZml4LlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVzdEFmdGVyID0gYXJncy5zbGljZShpICsgMik7XG4gICAgICBpZiAocmVzdEFmdGVyLmxlbmd0aCA+PSAyICYmICFTRURfU0NSSVBUX1NIQVBFLnRlc3QodykpIHtcbiAgICAgICAgLy8gVGhlIEJTRCBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZzogdyBpcyB0aGUgc3VmZml4LCBhbmQgYSBzY3JpcHQgcGx1c1xuICAgICAgICAvLyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBcdTIwMTQgb25seSBmb3IgYSBzdWZmaXgtc2hhcGVkXG4gICAgICAgIC8vIHdvcmQgKGAuYmFrYCwgYCcnYCkuIEEgc2NyaXB0LXNoYXBlZCB3b3JkIGlzIHRoZSBzY3JpcHQgdW5kZXIgR05VJ3NcbiAgICAgICAgLy8gcmVhZGluZywgc28gYHNlZCAtaSBzL2EvYi8gZiBnYCB0cmVhdHMgYHMvYS9iL2AgYXMgdGhlIHNjcmlwdCBhbmRcbiAgICAgICAgLy8gYm90aCBmIGFuZCBnIGFzIGZpbGVzLlxuICAgICAgICBzdWZmaXggPSB3O1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gYHNlZCAtaSBmYDogdyBpcyB0aGUgbGFzdCB0b2tlbiBcdTIwMTQgbm8gc2NyaXB0IGNhbiBmb2xsb3csIHNvIHcgaXMgdGhlXG4gICAgICAgIC8vIGZpbGUgb3BlcmFuZCB3aXRoIHRoZSBzY3JpcHQgYWJzZW50IChHTlUgaW5zdGVhZCByZWFkcyB3IGFzIGEgc2NyaXB0XG4gICAgICAgIC8vIGFuZCBlcnJvcnM7IGVpdGhlciB3YXkgdGhlIGVkaXQgZG9lcyBub3QgaGFwcGVuKS5cbiAgICAgICAgZmlsZXMucHVzaCh3KTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIE9uZSB0b2tlbiBhZnRlciB3OiB3IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgKG9yIGEgZmlsZSwgd2hlbiBgLWVgXG4gICAgICAvLyBzY3JpcHRzIGFyZSBwcmVzZW50KSBhbmQgdGhlIHRva2VuIGlzIGEgZmlsZSBcdTIwMTQgY29uc3VtZSBib3RoLCBzb1xuICAgICAgLy8gbmVpdGhlciBmYWxscyB0aHJvdWdoIHRvIHRoZSBwb3NpdGlvbmFsIHBhdGggYWdhaW4uXG4gICAgICBwb3NpdGlvbmFscy5wdXNoKHcsIHJlc3RBZnRlclswXSk7XG4gICAgICBpICs9IDM7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLWknKSAmJiBhLmxlbmd0aCA+IDIpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgc3VmZml4ID0gYS5zbGljZSgyKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIC8vIFVua25vd24gb3B0aW9uIFx1MjAxNCBuZXZlciBhIHNjcmlwdCBvciBmaWxlLlxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG5cbiAgaWYgKCFzYXdJbnBsYWNlKSByZXR1cm47IC8vIG5vdCBhbiBpbi1wbGFjZSBlZGl0IGF0IGFsbFxuICBjb25zdCBzY3JpcHRBcmcgPSBlU2NyaXB0cy5sZW5ndGggPT09IDAgPyAocG9zaXRpb25hbHNbMF0gPz8gbnVsbCkgOiBudWxsO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzLnNsaWNlKDEpKTtcbiAgZWxzZSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzKTtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIHNlZ21lbnRzLnB1c2goLi4uc2NyaXB0QXJnLnNwbGl0KCc7JykpO1xuICBmb3IgKGNvbnN0IHMgb2YgZVNjcmlwdHMpIHNlZ21lbnRzLnB1c2goLi4ucy5zcGxpdCgnOycpKTtcbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGZpbGVzWzBdID8/ICdzZWQnLCAnbm8gc2NyaXB0IChhYnNlbnQgb3IgZW1wdHkgc2NyaXB0IGFyZ3VtZW50KScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFNlZ21lbnQgY2xhc3NpZmljYXRpb246IGV4YWN0IHdoZW4gZXZlcnkgc2VnbWVudCBpcyBhIG51bWVyaWMtYWRkcmVzc2VkXG4gIC8vIHN1YnN0aXR1dGlvbjsgZXhwbGljaXQgd2hvbGUtZmlsZSBbMSwgRU9GXSB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgc3RpbGwgYVxuICAvLyBzdWJzdGl0dXRpb24gKGFueSB1bmFkZHJlc3NlZC9udW1lcmljIG1peCk7IG5vIHJhbmdlIG90aGVyd2lzZS5cbiAgbGV0IGFsbE51bWVyaWMgPSB0cnVlO1xuICBsZXQgYWxsU3Vic3RpdHV0aW9uID0gdHJ1ZTtcbiAgbGV0IG1pblN0YXJ0ID0gSW5maW5pdHk7XG4gIGxldCBtYXhFbmQgPSAwO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICBjb25zdCBtID0gc2VnbWVudC5tYXRjaChOVU1FUklDX1NVQlNUSVRVVElPTik7XG4gICAgaWYgKG0gPT09IG51bGwpIHtcbiAgICAgIGFsbE51bWVyaWMgPSBmYWxzZTtcbiAgICAgIGlmICghVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTi50ZXN0KHNlZ21lbnQpKSBhbGxTdWJzdGl0dXRpb24gPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBzID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCBlID0gbVsyXSA9PT0gdW5kZWZpbmVkID8gcyA6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCk7XG4gICAgbWluU3RhcnQgPSBNYXRoLm1pbihtaW5TdGFydCwgcyk7XG4gICAgbWF4RW5kID0gTWF0aC5tYXgobWF4RW5kLCBlKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZiBvZiBmaWxlcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShmKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZiwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBmKTtcbiAgICBpZiAoYWxsTnVtZXJpYyB8fCBhbGxTdWJzdGl0dXRpb24pIHtcbiAgICAgIGNvbnN0IHRvdGFsID0gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgICByZXN1bHRzLFxuICAgICAgICAgICdzZWQtaW5wbGFjZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIG1pc3NpbmcpJ1xuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN0YXJ0ID0gYWxsTnVtZXJpYyA/IG1pblN0YXJ0IDogMTtcbiAgICAgIGNvbnN0IGVuZCA9IGFsbE51bWVyaWMgPyBNYXRoLm1pbihtYXhFbmQsIHRvdGFsKSA6IHRvdGFsO1xuICAgICAgaWYgKHN0YXJ0ID4gZW5kKSBjb250aW51ZTsgLy8gdGhlIGFkZHJlc3NlZCByYW5nZSBsaWVzIGJleW9uZCBFT0YgXHUyMDE0IG5vdGhpbmcgaXMgbW9kaWZpZWRcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHN1ZmZpeCAhPT0gbnVsbCAmJiBzdWZmaXggIT09ICcnKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGg6IGAke2Fic29sdXRlUGF0aH0ke3N1ZmZpeH1gLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBhdGNoIC8gZ2l0IGFwcGx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KS4gUGF0Y2ggdGV4dCBzb3VyY2VzLCBpbiBvcmRlciBvZlxuLy8gcmVjb2duaXRpb246IGEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGBnaXQgYXBwbHkgPGZpbGU+YCBcdTIwMTQgYSBgcGF0Y2hgXG4vLyBvcGVyYW5kIGlzIGEgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSwgYW5kIGlzIGlnbm9yZWQpLCB0aGUgc3RkaW4gYDxgXG4vLyBzb3VyY2UgKGBwYXRjaCAtcE4gPCBmaWxlYCwgYGdpdCBhcHBseSAtIDwgZmlsZWApLCBvciBhIGhlcmVkb2MgYm9keVxuLy8gKGNsYXNzaWZ5UGF0Y2hIZXJlZG9jLCBcdTAwQTc1LjIpLiBSZWFkLW9ubHkgbW9kZXMgKGAtLWNoZWNrYC9gLS1zdGF0YC9cbi8vIGAtLW51bXN0YXRgL2AtLXN1bW1hcnlgLCBgcGF0Y2ggLS1kcnktcnVuYCkgYW5kIGluZGV4LW9ubHkgYC0tY2FjaGVkYCB0b3VjaFxuLy8gbm90aGluZzsgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQgKGl0IHJld3JpdGVzIHBhdGNoIHBhdGhzKS4gQSBjb21tYW5kXG4vLyB3aXRoIG5vIHN0YXRpY2FsbHkga25vd24gc291cmNlIChwaXBlZCBvciB0ZXJtaW5hbCBzdGRpbiwgYSB2YXJpYWJsZSBwYXRjaFxuLy8gcGF0aCkgaXMgdW5yZXNvbHZlZC4gVGFyZ2V0cyBhbmQgcmFuZ2VzIGNvbWUgZnJvbSB0aGUgbmV3XG4vLyByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHVuaWZpZWQtZGlmZi50cykuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzaGFyZWQgYHBhdGNoYC9gZ2l0IGFwcGx5YCBvcHRpb24gc3VyZmFjZSAocGxhbiBcdTAwQTc1LjcpOiBzdHJpcCBsZXZlbCwgcmVhZC1vbmx5IGFuZCBpbmRleC1vbmx5IG1vZGVzLCBgLS1kaXJlY3RvcnlgLCBhbmQgb3BlcmFuZHMuICovXG5pbnRlcmZhY2UgUGF0Y2hBcHBseVBhcnRzIHtcbiAgc3RyaXA6IFBhdGhTdHJpcDtcbiAgcmVhZE9ubHk6IGJvb2xlYW47XG4gIGNhY2hlZE9ubHk6IGJvb2xlYW47XG4gIGRpcmVjdG9yeTogYm9vbGVhbjtcbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBwYXRjaEFwcGx5UGFydHMoYXJnczogc3RyaW5nW10sIGlzR2l0QXBwbHk6IGJvb2xlYW4pOiBQYXRjaEFwcGx5UGFydHMge1xuICBsZXQgc3RyaXA6IFBhdGhTdHJpcCA9IGlzR2l0QXBwbHkgPyAxIDogJ2F1dG8nO1xuICBsZXQgcmVhZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGNhY2hlZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGRpcmVjdG9yeSA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgICBpZiAoYSA9PT0gJy0tY2hlY2snIHx8IGEgPT09ICctLXN0YXQnIHx8IGEgPT09ICctLW51bXN0YXQnIHx8IGEgPT09ICctLXN1bW1hcnknKSB7XG4gICAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0tY2FjaGVkJykge1xuICAgICAgICBjYWNoZWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0taW5kZXgnIHx8IGEgPT09ICctUicgfHwgYSA9PT0gJy0tcmV2ZXJzZScgfHwgYSA9PT0gJy0tdW5zYWZlLXBhdGhzJyB8fCBhID09PSAnLS1yZWplY3QnKSBjb250aW51ZTtcbiAgICAgIGlmIChhID09PSAnLS1kaXJlY3RvcnknKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1kaXJlY3Rvcnk9JykpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBwYXRjaFxuICAgIGlmIChhID09PSAnLS1kcnktcnVuJykge1xuICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLU4nIHx8IGEgPT09ICctLWZvcndhcmQnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgc3RyaXAsIHJlYWRPbmx5LCBjYWNoZWRPbmx5LCBkaXJlY3RvcnksIG9wZXJhbmRzIH07XG59XG5cbi8qKiBUaGUgcGF0Y2ggdGV4dCBhdCBgYWJzb2x1dGVQYXRoYCwgb3IgbnVsbCB3aGVuIGl0IGNhbid0IGJlIHJlYWQuICovXG5mdW5jdGlvbiByZWFkUGF0Y2hGaWxlKGFic29sdXRlUGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogRW1pdCB0aGUgd3JpdGUgdG91Y2hlcyBmb3IgYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGNvbW1hbmQgd2l0aCBhIHN0YXRpY2FsbHlcbiAqIGtub3duIHBhdGNoLXRleHQgc291cmNlLiBgdGFyZ2V0RGlyYCBpcyB3aGVyZSB0aGUgcGF0Y2gncyB0YXJnZXQgcGF0aHNcbiAqIHJlc29sdmUgKHRoZSBnaXQgYC1DYCBkaXJlY3RvcnkgZm9yIGBnaXQgYXBwbHlgLCB0aGUgY3VycmVudCBkaXJlY3RvcnlcbiAqIG90aGVyd2lzZSk7IGBzaGVsbERpcmAgaXMgd2hlcmUgdGhlIHNoZWxsJ3Mgc3RkaW4gYDxgIHJlZGlyZWN0IHRhcmdldFxuICogcmVzb2x2ZXMgXHUyMDE0IGEgcmVkaXJlY3QgaXMgc2hlbGwtc2lkZSwgc28gYGdpdCAtQ2AgbmV2ZXIgYWZmZWN0cyBpdC5cbiAqL1xuZnVuY3Rpb24gZW1pdFBhdGNoVGFyZ2V0cyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGlzR2l0QXBwbHk6IGJvb2xlYW4sXG4gIGhvc3Q6IHN0cmluZyxcbiAgdGFyZ2V0RGlyOiBzdHJpbmcsXG4gIHNoZWxsRGlyOiBzdHJpbmcsXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjsgLy8gcmVhZC1vbmx5IC8gaW5kZXgtb25seSBcdTIwMTQgbm8gdG91Y2hlc1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IHBhdGNoVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyAxLiBBIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChnaXQgYXBwbHkgb25seTsgYSBwYXRjaCBvcGVyYW5kIGlzIGFcbiAgLy8gICAgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSBcdTIwMTQgaWdub3JlZCkuXG4gIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgY29uc3Qgb3BlcmFuZCA9IHBhcnRzLm9wZXJhbmRzLmZpbmQoKG8pID0+IG8gIT09ICctJyk7XG4gICAgaWYgKG9wZXJhbmQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aCh0YXJnZXREaXIsIG9wZXJhbmQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCBmaWxlIHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDIuIFRoZSBzdGRpbiBgPGAgc291cmNlIChwYXRjaCBhbmQgZ2l0IGFwcGx5KS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIGNvbnN0IHN0ZGluID0gcmVkaXJlY3RzLmZpbmQoKHIpID0+IHIub3AgPT09ICc8Jyk7XG4gICAgaWYgKHN0ZGluICE9PSB1bmRlZmluZWQgJiYgc3RkaW4udGFyZ2V0ICE9PSBudWxsKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUoc3RkaW4udGFyZ2V0KSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzdGRpbi50YXJnZXQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aChzaGVsbERpciwgc3RkaW4udGFyZ2V0KTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggdGV4dCB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAzLiBObyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZTogc3RkaW4gaXMgZHluYW1pYyAodGVybWluYWwsIHBpcGUsIHZhcmlhYmxlKS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIGhvc3QsICdubyBzdGF0aWNhbGx5IGtub3duIHBhdGNoIHRleHQgc291cmNlIChzdGRpbiBpcyBkeW5hbWljKScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlID8/IGhvc3QsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCB0YXJnZXREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHBhdGNoL2dpdCBhcHBseSBncmFtbWFyIGluIHRoZSBtYWluIHdhbGs6IGBwYXRjaGAgcmVhZHMgcGF0Y2ggdGV4dCBmcm9tXG4gKiBzdGRpbiBvciBhIGA8YCByZWRpcmVjdDsgYGdpdCBhcHBseWAgYWRkaXRpb25hbGx5IGFjY2VwdHMgYSBwYXRjaC1maWxlXG4gKiBvcGVyYW5kIGFuZCByZXNvbHZlcyB0YXJnZXRzIGFnYWluc3QgaXRzIGAtQ2AgZGlyZWN0b3J5LiBBIHdyYXBwZWRcbiAqIGBwYXRjaGAvYGFwcGx5YCBpcyB1bnJlc29sdmVkIFx1MjAxNCB0aGUgd3JhcHBlciBvYnNjdXJlcyB0aGUgYXJndi5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hQYXRjaEFwcGx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSksXG4gICAgICBmYWxzZSxcbiAgICAgICdwYXRjaCcsXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSksXG4gICAgICB0cnVlLFxuICAgICAgJ2FwcGx5JyxcbiAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3BhdGNoJyB8fCB3cmFwcGVkID09PSAnYXBwbHknKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2MgcGF0Y2gtdGV4dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuNyk6IGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBoZXJlZG9jXG4gKiBib2R5IGlzIHBhdGNoIHRleHQuIFRoZSBvcGVuZXIncyBvd24gb3B0aW9ucyBzdGlsbCBhcHBseSBcdTIwMTQgYC0tZHJ5LXJ1bmAvXG4gKiBgLS1jaGVja2AvYC0tc3RhdGAvYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAvYC0tY2FjaGVkYCBtYWtlIHRoZSBib2R5XG4gKiByZWFkLW9ubHkgKG5vIHRvdWNoZXMpLCBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCwgYW5kIGAtcE5gIHNldHMgdGhlXG4gKiBoZWFkZXIgc3RyaXAgbGV2ZWwuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgYm9keTogc3RyaW5nLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IGlzR2l0QXBwbHkgPSBmYWxzZTtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdO1xuICBsZXQgZGlyID0gY3VycmVudERpcjtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaXNHaXRBcHBseSA9IHRydWU7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGRpciA9IHN1Yi5jRGlyID8/IGN1cnJlbnREaXI7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuO1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UoYm9keSwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdoZXJlZG9jJywgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIGRpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZm9ybWF0dGVyIC8gZml4ZXIgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjgpOiBhIHRhYmxlLWRyaXZlbiBmYW1pbHkgb3ZlciB0aGVcbi8vIGNvcnB1cy1kZXJpdmVkIDE2LXRvb2wgc2V0LiBGbGFnIG1hdGNoaW5nIGlzIGV4YWN0LXRva2VuIG9uIGZ1bGwgYXJndiB3b3JkcyBcdTIwMTRcbi8vIG5ldmVyIHByZWZpeCBvciBzdWJzdHJpbmcgXHUyMDE0IGFuZCB0aGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0LCBzb1xuLy8gYC0tZml4LWRyeS1ydW5gIGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYC0tZml4YCBhbmQgYGJsYWNrIC0tY2hlY2tgIG5ldmVyXG4vLyBoZWFscy4gVG9vbHMgd2hvc2Ugd3JpdGUgZm9ybSBpcyBhIGJhcmUgaW52b2NhdGlvbiAoYmxhY2ssIGlzb3J0LCBydXN0Zm10KVxuLy8gY2FycnkgdGhlIGVtcHR5IGZvcm0gYW5kIGZpcmUgb24gdGhlIHdyaXRlIGZvcm0gaXRzZWxmLiBMZWFkaW5nIHRyYW5zcGFyZW50XG4vLyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVycyAobnB4LCB5YXJuLCBwbnBtIGV4ZWMvZGx4LCBidW54LCBucG0gZXhlYykgc3RyaXBcbi8vIHVuZGVyIGEgcGlubmVkIG9wdGlvbiBncmFtbWFyOyBhIHdyYXBwZXIgdGhhdCBjb3VsZCByZXdyaXRlIGFyZ3YgZmFpbHNcbi8vIGNsb3NlZCBhcyB1bnJlc29sdmVkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBPbmUgXHUwMEE3NS44IHRhYmxlIHJvdzogdGhlIHRvb2wgY29tbWFuZCBhbmQgaXRzIHdyaXRlL3JlYWQtb25seSB0b2tlbiBmb3Jtcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9ybWF0dGVyVG9vbFJvdyB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyB3aG9zZSBleGFjdC10b2tlbiBwcmVzZW5jZSBtYXJrcyB0aGUgaW52b2NhdGlvbiBhIHdyaXRlLiAqL1xuICB3cml0ZUZvcm1zOiBzdHJpbmdbXVtdO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIGNvbnN1bHRlZCBmaXJzdCBcdTIwMTQgcHJlc2VuY2Ugc3VwcHJlc3NlcyB0aGUgd3JpdGUgKHRoZSByZWFkLW9ubHkgbW9kZSB3aW5zKS4gKi9cbiAgcmVhZE9ubHlGb3Jtczogc3RyaW5nW11bXTtcbn1cblxuLyoqXG4gKiBUaGUgXHUwMEE3NS44IHRhYmxlLCBleHBvcnRlZCBzbyB0aGUgY29ycHVzLWNvdmVyYWdlIGZpeHR1cmUgY2FuIGFzc2VydCB0d28tc2lkZWRcbiAqIHRvb2wtc2V0IGVxdWFsaXR5IGFuZCBwZXItdG9vbCByZWFkLW9ubHkgc3VwcHJlc3Npb24gKHBsYW4gXHUwMEE3NS44LCBQaGFzZSAzXG4gKiBzdGVwIDgpLlxuICovXG5leHBvcnQgY29uc3QgRk9STUFUVEVSX1RBQkxFOiByZWFkb25seSBGb3JtYXR0ZXJUb29sUm93W10gPSBbXG4gIHtcbiAgICBjb21tYW5kOiAncHJldHRpZXInLFxuICAgIHdyaXRlRm9ybXM6IFtbJy0td3JpdGUnXSwgWyctdyddXSxcbiAgICByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1saXN0LWRpZmZlcmVudCddLCBbJy0tZGVidWctY2hlY2snXV1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZXNsaW50Jywgd3JpdGVGb3JtczogW1snLS1maXgnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZml4LWRyeS1ydW4nXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdiaW9tZScsXG4gICAgd3JpdGVGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLXdyaXRlJ10sXG4gICAgICBbJ2NoZWNrJywgJy0tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLXdyaXRlJ11cbiAgICBdLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2dvZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1sJ11dIH0sXG4gIHsgY29tbWFuZDogJ2dvaW1wb3J0cycsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbXSB9LFxuICB7IGNvbW1hbmQ6ICdjbGFuZy1mb3JtYXQnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kcnktcnVuJ11dIH0sXG4gIHsgY29tbWFuZDogJ3NoZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ11dIH0sXG4gIHsgY29tbWFuZDogJ3lhcGYnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2F1dG9wZXA4Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2JsYWNrJywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdpc29ydCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2stb25seSddLCBbJy0tZGlmZiddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3J1ZmYnLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2Zvcm1hdCddLCBbJ2NoZWNrJywgJy0tZml4J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS1uby1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0tY2hlY2snXVxuICAgIF1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZGVubycsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snZm10JywgJy0tY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAnZHByaW50Jywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydjaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdydXN0Zm10Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZW1pdCcsICdzdGRvdXQnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICd0ZXJyYWZvcm0nLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2ZtdCcsICctY2hlY2snXSxcbiAgICAgIFsnZm10JywgJy1kaWZmJ11cbiAgICBdXG4gIH1cbl07XG5cbi8qKiBUaGUgcGlubmVkIHBhY2thZ2UtcnVubmVyIG5vLWFyZyBmbGFncyAocGxhbiBcdTAwQTc1LjgpOiBmbGFncyB0aGF0IGNhbm5vdCBtb3ZlIG9yIHJld3JpdGUgYXJndi4gKi9cbmNvbnN0IFJVTk5FUl9OT19BUkdfRkxBR1MgPSBuZXcgU2V0KFsnLXknLCAnLS15ZXMnLCAnLS1uby1pbnN0YWxsJ10pO1xuXG4vKiogVGhlIG91dGNvbWUgb2Ygc3RyaXBwaW5nIG9uZSBsZWFkaW5nIHBhY2thZ2UtcnVubmVyIHdyYXBwZXIuICovXG50eXBlIFJ1bm5lclN0cmlwID0geyBraW5kOiAnc3RyaXBwZWQnOyBzdHJpcHBlZDogc3RyaW5nW10gfSB8IHsga2luZDogJ29ic2N1cmVkJyB9O1xuXG4vKipcbiAqIFN0cmlwIG9uZSBsZWFkaW5nIHRyYW5zcGFyZW50IHBhY2thZ2UtcnVubmVyIHdyYXBwZXIgKHBsYW4gXHUwMEE3NS44KTogYG5weGAsXG4gKiBgeWFybmAsIGBwbnBtIGV4ZWNgL2BwbnBtIGRseGAsIGBidW54YCwgYW5kIGBucG0gZXhlY2AgZm9sbG93ZWQgZGlyZWN0bHkgYnlcbiAqIHRoZSB3cmFwcGVkIGNvbW1hbmQgd29yZCwgd2l0aCBvbmx5IHRoZSBwaW5uZWQgbm8tYXJnIGZsYWdzIChgLXlgL2AtLXllc2AsXG4gKiBgLS1uby1pbnN0YWxsYCkgYW5kIGBucG0gZXhlY2AncyBgLS1gIHRlcm1pbmF0b3IgYmV0d2Vlbi4gQSBzdHJpbmctZm9ybVxuICogYXJndW1lbnQgKGBucHggXCJwcmV0dGllciAtLXdyaXRlIGZcImApLCBhbiBhcmd2LWFsdGVyaW5nIHJ1bm5lciBmbGFnXG4gKiAoYC0tcGFja2FnZT1YYCBvciBhIGZsYWcgY29uc3VtaW5nIHRoZSBuZXh0IHdvcmQpLCBvciBhIHdyYXBwZXIgd29yZCB0aGF0IGlzXG4gKiBpdHNlbGYgYSBzY3JpcHQgKGAuYC1wcmVmaXhlZCkgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndiBcdTIwMTQgdGhlIHdyYXBwZXIgaXNcbiAqIHRyYW5zcGFyZW50IG9ubHkgd2hlbiB0aGUgcGlubmVkIGdyYW1tYXIgcHJvdmVzIGl0IHNvLiBSZXR1cm5zICdub3QtcnVubmVyJ1xuICogd2hlbiB0aGUgd29yZCBpcyBub3QgYSBydW5uZXIgYXQgYWxsIChhIGRpZmZlcmVudCBucG0vcG5wbSBzdWJjb21tYW5kLCBvciBhXG4gKiBiYXJlIHJ1bm5lciB3aXRoIG5vIGNvbW1hbmQgd29yZCkgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LCB3aGljaFxuICogZmFpbHMgY2xvc2VkIGZvciBub24tZm9ybWF0dGVyIHJ1bm5lcnMuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwUGFja2FnZVJ1bm5lcihhcmd2OiBzdHJpbmdbXSk6IFJ1bm5lclN0cmlwIHwgJ25vdC1ydW5uZXInIHtcbiAgY29uc3QgcnVubmVyID0gYXJndlswXTtcbiAgbGV0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnB4JyB8fCBydW5uZXIgPT09ICd5YXJuJyB8fCBydW5uZXIgPT09ICdidW54Jykge1xuICAgIC8vIFRoZXNlIHJ1bm5lcnMgdGFrZSB0aGUgY29tbWFuZCB3b3JkIGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ3BucG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJyAmJiByZXN0WzBdICE9PSAnZGx4JykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICducG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gJ25vdC1ydW5uZXInO1xuICB9XG4gIHdoaWxlIChSVU5ORVJfTk9fQVJHX0ZMQUdTLmhhcyhyZXN0WzBdKSkgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducG0nICYmIHJlc3RbMF0gPT09ICctLScpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybiAnbm90LXJ1bm5lcic7IC8vIGEgYmFyZSBydW5uZXIgYXR0cmlidXRlcyBub3RoaW5nXG4gIGNvbnN0IHdyYXBwZWQgPSByZXN0WzBdO1xuICBpZiAod3JhcHBlZC5zdGFydHNXaXRoKCctJykgfHwgd3JhcHBlZC5zdGFydHNXaXRoKCcuJykgfHwgL1xccy8udGVzdCh3cmFwcGVkKSkgcmV0dXJuIHsga2luZDogJ29ic2N1cmVkJyB9O1xuICByZXR1cm4geyBraW5kOiAnc3RyaXBwZWQnLCBzdHJpcHBlZDogcmVzdCB9O1xufVxuXG4vKipcbiAqIFRoZSBmb3JtYXR0ZXIvZml4ZXIgZmFtaWx5IChwbGFuIFx1MDBBNzUuOCkuIFRoZSByZWFkLW9ubHkgZm9ybXMgYXJlIGNvbnN1bHRlZFxuICogZmlyc3QgYW5kIHdpbiBvdmVyIGFueSB3cml0ZSBmb3JtOyBhIHdyaXRlIGZvcm0gd2l0aCBubyByZWFkLW9ubHkgZm9ybSBhbmRcbiAqIGV2ZXJ5IG9wZXJhbmQgYW4gZXhwbGljaXQgZmlsZSBlbWl0cyBhIHdob2xlLWZpbGUgYG1vZGlmeWAgcGVyIG9wZXJhbmQ7XG4gKiBkaXJlY3RvcnkvZ2xvYi9uby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmc7IHVua25vd24gZXhlY3V0YWJsZXNcbiAqIGZhaWwgY2xvc2VkLiBBIGZvcm0ncyBsZWFkaW5nIHN1YmNvbW1hbmQgd29yZCAoYGNoZWNrYC9gZm9ybWF0YC9gZm10YCkgaXNcbiAqIHBvc2l0aW9uYWwgXHUyMDE0IGl0IG11c3QgbGVhZCB0aGUgdG9vbCdzIGFyZ3MsIHNvIGBkZW5vIHRhc2sgZm10YCBpcyBhIHNjcmlwdFxuICogcnVubmVyLCBub3QgYSBmb3JtYXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoRm9ybWF0dGVyKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgbGV0IHdvcmRzID0gcmVzdDtcbiAgY29uc3Qgc3RyaXAgPSBzdHJpcFBhY2thZ2VSdW5uZXIocmVzdCk7XG4gIGlmIChzdHJpcCA9PT0gJ25vdC1ydW5uZXInKSB7XG4gICAgLy8gcmVzdFswXSBpcyBub3QgYSBwYWNrYWdlIHJ1bm5lciBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAoc3RyaXAua2luZCA9PT0gJ29ic2N1cmVkJykge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCByZXN0WzBdLCBgdGhlICR7cmVzdFswXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2YCk7XG4gICAgcmV0dXJuO1xuICB9IGVsc2Uge1xuICAgIHdvcmRzID0gc3RyaXAuc3RyaXBwZWQ7XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKHdvcmRzWzBdKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSB3b3Jkc1sxXTtcbiAgICBpZiAod3JhcHBlZCAhPT0gdW5kZWZpbmVkICYmIEZPUk1BVFRFUl9UQUJMRS5zb21lKChyKSA9PiByLmNvbW1hbmQgPT09IHdyYXBwZWQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke3dvcmRzWzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvdyA9IEZPUk1BVFRFUl9UQUJMRS5maW5kKChyKSA9PiByLmNvbW1hbmQgPT09IHdvcmRzWzBdKTtcbiAgaWYgKHJvdyA9PT0gdW5kZWZpbmVkKSByZXR1cm47IC8vIHVua25vd24gZXhlY3V0YWJsZSBcdTIwMTQgZmFpbCBjbG9zZWQsIG5vIHRvdWNoXG4gIGNvbnN0IGFyZ3MgPSB3b3Jkcy5zbGljZSgxKTtcbiAgY29uc3QgZm9ybVByZXNlbnQgPSAoZm9ybTogc3RyaW5nW10pOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBmaXJzdCA9IGZvcm1bMF07XG4gICAgaWYgKGZpcnN0ICE9PSB1bmRlZmluZWQgJiYgIWZpcnN0LnN0YXJ0c1dpdGgoJy0nKSAmJiBhcmdzWzBdICE9PSBmaXJzdCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBmb3JtLmV2ZXJ5KCh0b2tlbikgPT4gYXJncy5pbmNsdWRlcyh0b2tlbikpO1xuICB9O1xuICAvLyBUaGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0IGFuZCB3aW5zIG92ZXIgYW55IHdyaXRlIGZvcm06XG4gIC8vIGBlc2xpbnQgLS1maXggLS1maXgtZHJ5LXJ1biBmYCB3cml0ZXMgbm90aGluZywgYGJsYWNrIC0tY2hlY2sgZmAgbmV2ZXIgaGVhbHMuXG4gIGlmIChyb3cucmVhZE9ubHlGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuO1xuICBpZiAoIXJvdy53cml0ZUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47IC8vIGJhcmUgaW52b2NhdGlvbnMgb2YgZmxhZy1yZXF1aXJlZCB0b29scyBhcmUgcmVhZC1vbmx5IChzdGRvdXQvbGludClcbiAgLy8gQ29uc3VtZSB0aGUgdG9vbCdzIHN1YmNvbW1hbmQgd29yZCBiZWZvcmUgY29sbGVjdGluZyBvcGVyYW5kcy5cbiAgY29uc3Qgc3ViY29tbWFuZFdvcmRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgZm9ybSBvZiByb3cud3JpdGVGb3Jtcykge1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgZm9ybSkge1xuICAgICAgaWYgKCF0b2tlbi5zdGFydHNXaXRoKCctJykpIHN1YmNvbW1hbmRXb3Jkcy5hZGQodG9rZW4pO1xuICAgIH1cbiAgfVxuICBjb25zdCBhZnRlclN1YmNvbW1hbmQgPSBzdWJjb21tYW5kV29yZHMuaGFzKGFyZ3NbMF0pID8gYXJncy5zbGljZSgxKSA6IGFyZ3M7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYWZ0ZXJTdWJjb21tYW5kKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoc2hhcmVkIFx1MDBBNzUpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAob3BlcmFuZHMubGVuZ3RoID09PSAwKSByZXR1cm47IC8vIG5vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZ1xuICAvLyBFdmVyeSBvcGVyYW5kIG11c3QgYmUgYW4gZXhwbGljaXQgZmlsZSBcdTIwMTQgYSBnbG9iLCB2YXJpYWJsZSwgZGlyZWN0b3J5LCBvclxuICAvLyB0cmFpbGluZy1zbGFzaCBvcGVyYW5kIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZC5cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSkpIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdmb3JtYXR0ZXItd3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KSwgdGhlIGxhc3QgcHVyZS1wYXJzZXJcbi8vIGZhbWlseS4gUmVzdG9yZSBoYXMgbm8gcmV2aXNpb24gb3BlcmFuZCBmb3JtIFx1MjAxNCBpdHMgcG9zaXRpb25hbCBhcmdzIGFyZVxuLy8gYWx3YXlzIHBhdGhzcGVjczsgY2hlY2tvdXQgc2tpcHMgYSBwcmUtYC0tYCByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgdGFrZXNcbi8vIHBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuIEV2ZXJ5IGV4cGxpY2l0LWZpbGUgcGF0aHNwZWMgaXMgYSB3aG9sZS1maWxlXG4vLyBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgKGAuYC9gLi5gLCB0cmFpbGluZyBgL2AsXG4vLyBvciBhIHBhdGggdGhhdCBzdGF0cyBhcyBhIGRpcmVjdG9yeSksIGAtLXN0YWdlZGAtb25seSByZXN0b3JlLCBhbmRcbi8vIGAtcGAvYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGFsbCBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogZ2l0IHJlc3RvcmUgbm8tdmFsdWUgZmxhZ3MgKHBsYW4gXHUwMEE3NS45KTsgYC1zYC9gLS1zb3VyY2VgLCBgLS1zdGFnZWRgLCBgLVdgL2AtLXdvcmt0cmVlYCwgYC1tYC9gLS1tZXJnZWAsIGFuZCBgLXBgL2AtLXBhdGNoYCBhcmUgaGFuZGxlZCBleHBsaWNpdGx5LiAqL1xuY29uc3QgUkVTVE9SRV9OT19WQUxVRSA9IG5ldyBTZXQoWyctcScsICctZicsICctdSddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJlc3RvcmUvY2hlY2tvdXQgcGF0aHNwZWMgZW1pc3Npb24gKHBsYW4gXHUwMEE3NS45KTogYW4gZXhwbGljaXQtZmlsZVxuICogcGF0aHNwZWMgKG5vIGdsb2JzLCBubyBgLmAvYC4uYCwgbm8gZGlyZWN0b3J5LCBubyB0cmFpbGluZyBgL2ApIGlzIGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgd2hvbGUtZmlsZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIGlzXG4gKiB1bnJlc29sdmVkIFx1MjAxNCBhIGRpcmVjdG9yeSByZXN0b3JlL2NoZWNrb3V0IHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoXG4gKiBpdCBhbmQgY2Fubm90IGJlIGF0dHJpYnV0ZWQgdG8gYSBmaWxlIHdyaXRlLlxuICovXG5mdW5jdGlvbiBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMoXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBpZGlvbTogJ2dpdC1yZXN0b3JlLXdyaXRlJyB8ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICBvcGVyYW5kOiBzdHJpbmcsXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBpZGlvbSwgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCk7XG4gIGlmIChvcGVyYW5kID09PSAnLicgfHwgb3BlcmFuZCA9PT0gJy4uJyB8fCBvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICByZXN1bHRzLFxuICAgICAgaWRpb20sXG4gICAgICBvcGVyYW5kLFxuICAgICAgJ2RpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGggaXQgXHUyMDE0IG5vdCBhdHRyaWJ1dGFibGUgdG8gYSBmaWxlIHdyaXRlJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tLFxuICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLXNgL2AtLXNvdXJjZT08dHJlZT5gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSB0cmVlIG9wZXJhbmQgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9gLS1wYXRjaGBcbiAqIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGAtbWAvYC0tbWVyZ2VgICh0aGUgbWVyZ2VcbiAqIG1hY2hpbmVyeSwgY29uZGl0aW9uYWwgb24gdGhlIGluZGV4IGJlaW5nIHVubWVyZ2VkKSBhbmQgYC0tc3RhZ2VkYCB3aXRob3V0XG4gKiBgLS13b3JrdHJlZWAgKGluZGV4LW9ubHkgXHUyMDE0IHRoZSB3b3JraW5nIGZpbGUgc3Vydml2ZXMpIHRvdWNoIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVzdG9yZU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3RhZ2VkID0gZmFsc2U7XG4gIGxldCB3b3JrdHJlZSA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtcmVzdG9yZS13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycgfHwgYSA9PT0gJy0tc291cmNlJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgdHJlZSBvcGVyYW5kIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXNvdXJjZT0nKSkgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbScgfHwgYSA9PT0gJy0tbWVyZ2UnKSByZXR1cm47XG4gICAgaWYgKGEgPT09ICctLXN0YWdlZCcpIHtcbiAgICAgIHN0YWdlZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctVycgfHwgYSA9PT0gJy0td29ya3RyZWUnKSB7XG4gICAgICB3b3JrdHJlZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFJFU1RPUkVfTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKHN0YWdlZCAmJiAhd29ya3RyZWUpIHJldHVybjsgLy8gaW5kZXgtb25seSByZXN0b3JlIGRvZXMgbm90IHRvdWNoIHRoZSB3b3JraW5nIGZpbGVcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtcmVzdG9yZS13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgY2hlY2tvdXQgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtYmAvYC1CYC9gLS1vcnBoYW4gPGJyYW5jaD5gXG4gKiBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgYnJhbmNoIG5hbWUgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9cbiAqIGAtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBhIHByZS1gLS1gIHBvc2l0aW9uYWwgaXNcbiAqIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIGlzIHNraXBwZWQuIFBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1iJyB8fCBhID09PSAnLUInIHx8IGEgPT09ICctLW9ycGhhbicpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIGJyYW5jaCBuYW1lIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLXEnIHx8IGEgPT09ICctbScgfHwgYSA9PT0gJy10JykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICAvLyBBIHByZS1gLS1gIHBvc2l0aW9uYWwgaXMgYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBcdTIwMTQgbmV2ZXIgYSBwYXRoc3BlYy5cbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1jaGVja291dC13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBmYW1pbHkgKHBsYW4gXHUwMEE3NS45KTogdmlhIGBmaW5kR2l0U3ViY29tbWFuZGBcbiAqIChoYW5kbGVzIGBnaXQgLUNgL2AtY2ApLCB0aGUgdHdvIHN1YmNvbW1hbmRzIHJlc29sdmUgdGhlaXIgcGF0aHNwZWNzIHRvXG4gKiB3aG9sZS1maWxlIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgYSB3cmFwcGVkIHN1YmNvbW1hbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBtYXRjaEdpdFJlc3RvcmVDaGVja291dChcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IChzdWIuc3ViY29tbWFuZCAhPT0gJ3Jlc3RvcmUnICYmIHN1Yi5zdWJjb21tYW5kICE9PSAnY2hlY2tvdXQnKSkgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kLFxuICAgICAgICAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGlyID0gc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbjtcbiAgICBjb25zdCBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScpIG1hdGNoUmVzdG9yZU9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICBlbHNlIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncmVzdG9yZScgfHwgd3JhcHBlZCA9PT0gJ2NoZWNrb3V0Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHdyYXBwZWQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgTElORV9TRUxFQ1RPUlMgPSBbbWF0Y2hTZWQsIG1hdGNoSGVhZCwgbWF0Y2hUYWlsXTtcblxuLyoqXG4gKiBTcGFuLWxlc3MgY29tbWFuZHMgd2hvc2UgZXhpdCBzdGF0dXMgaXMgZGV0ZXJtaW5pc3RpYyBcdTIwMTQgdXNhYmxlIGFzIGd1YXJkcyBpblxuICogYCYmYC9gfHxgIGpvaW5zIChwbGFuIFx1MDBBNzMgc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkIHJ1bGUpOiBgZmFsc2VgIGFsd2F5c1xuICogZXhpdHMgMSwgYHRydWVgIGFuZCBgOmAgYWx3YXlzIDAsIHNvIGEgZm9sbG93aW5nIGpvaW5lZCBjb21tYW5kJ3Mgc2tpcCBpc1xuICoga25vd2FibGUgZXZlbiB0aG91Z2ggbmVpdGhlciBwcm9kdWNlcyBhIHNwYW4uXG4gKi9cbmNvbnN0IEJVSUxUSU5fR1VBUkRfU1RBVFVTID0gbmV3IE1hcDxzdHJpbmcsIDAgfCAxPihbXG4gIFsnZmFsc2UnLCAxXSxcbiAgWyd0cnVlJywgMF0sXG4gIFsnOicsIDBdXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogU3Bhbk1hdGNoW10ge1xuICBjb25zdCB7IHdyaXRlczogaGVyZWRvY1dyaXRlcywgbWFza2VkIH0gPSBleHRyYWN0SGVyZWRvY1dyaXRlcyhjb21tYW5kKTtcbiAgY29uc3Qgc2ltcGxlQ29tbWFuZHMgPSBzcGxpdFRvcExldmVsKG1hc2tlZCk7XG5cbiAgY29uc3QgcmVzdWx0czogU3Bhbk1hdGNoW10gPSBbXTtcbiAgY29uc3QgZnNMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcbiAgY29uc3QgZ2l0TGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG5cbiAgY29uc3QgY2FjaGVkRnNUb3RhbExpbmVzID0gKGFic1BhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGlmICghZnNMaW5lQ2FjaGUuaGFzKGFic1BhdGgpKSBmc0xpbmVDYWNoZS5zZXQoYWJzUGF0aCwgY291bnRGaWxlTGluZXMoYWJzUGF0aCkpO1xuICAgIHJldHVybiBmc0xpbmVDYWNoZS5nZXQoYWJzUGF0aCkgPz8gbnVsbDtcbiAgfTtcbiAgY29uc3QgY2FjaGVkR2l0VG90YWxMaW5lcyA9IChnaXRDd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGAke2dpdEN3ZH1cdTAwMDAke3Jldn1cdTAwMDAke3BhdGh9YDtcbiAgICBpZiAoIWdpdExpbmVDYWNoZS5oYXMoa2V5KSkgZ2l0TGluZUNhY2hlLnNldChrZXksIGNvdW50R2l0QmxvYkxpbmVzKGdpdEN3ZCwgcmV2LCBwYXRoKSk7XG4gICAgcmV0dXJuIGdpdExpbmVDYWNoZS5nZXQoa2V5KSA/PyBudWxsO1xuICB9O1xuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgbGFzdFBsYWluRmlsZVNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIFRoZSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKHBsYW4gXHUwMEE3NS4yKTogc2V0IGF0IHRoZSBlbmQgb2ZcbiAgLy8gZWFjaCBzaW1wbGUgY29tbWFuZCwgY2xlYXJlZCBhdCBhbnkgbm9uLXBpcGUgYm91bmRhcnksIHRocmVhZGVkIGJ5IHRlZSAtYVxuICAvLyBhcHBlbmRzIGluIHRoZSBuZXh0IHBpcGUgc3RhZ2UgKGBlY2hvIHggfCB0ZWUgLWEgZmApLlxuICBsZXQgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAvKiogVGhlIGBqb2luYCBzdGFtcCBmb3IgYSBzaW1wbGUgY29tbWFuZDogb25seSB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBjb25zdCBqb2luT2YgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kKTogUmVzb2x2ZWRTcGFuWydqb2luJ10gPT5cbiAgICBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJyYmJyB8fCBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ3x8JyA/IHNpbXBsZS5wcmVjZWRlZEJ5IDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoXG4gICAgYzogUmF3Q2FuZGlkYXRlLFxuICAgIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuICApID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWxMaW5lcyA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhjLmRpck92ZXJyaWRlID8/IGRpckZvclJlc29sdXRpb24sIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW5cbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvKipcbiAgICogVGhlIHJlYWQgaWRpb21zIGZvciBvbmUgc2ltcGxlIGNvbW1hbmQgKHRoZSBleGlzdGluZyBjb3JwdXMgZ3JhbW1hcik6XG4gICAqIHBsYWluIGBjYXRgL2BubGAgc291cmNlcywgdGhlIGxpbmUgc2VsZWN0b3JzLCBhbmQgdGhlIGdpdCBtYXRjaGVycywgd2l0aFxuICAgKiBvbmUtaG9wIHBpcGUtc291cmNlIHByb3BhZ2F0aW9uIGZvciBkb3duc3RyZWFtIGBoZWFkYC9gdGFpbGAvYHNlZCAtbmAuXG4gICAqL1xuICBjb25zdCBtYXRjaFJlYWRzID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10sIGk6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGxldCBpc1BsYWluU291cmNlID0gZmFsc2U7XG4gICAgbGV0IHBsYWluRmlsZUFyZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnICYmIGFyZ3YubGVuZ3RoID09PSAyICYmICFhcmd2WzFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBwbGFpbkZpbGVBcmcgPSBhcmd2WzFdO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGFyZ3ZbMV0pID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGFyZ3ZbMV0pO1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ25sJyAmJiBhcmd2Lmxlbmd0aCA+PSAyICYmICFhcmd2W2FyZ3YubGVuZ3RoIC0gMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IGYgPSBhcmd2W2FyZ3YubGVuZ3RoIC0gMV07XG4gICAgICBwbGFpbkZpbGVBcmcgPSBmO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGYpID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGYpO1xuICAgIH1cblxuICAgIC8vIEEgYmFyZSBgY2F0IGZpbGVgL2BubCBmaWxlYCB0aGF0IGlzIG5vdCBmZWVkaW5nIGEgZG93bnN0cmVhbSBwaXBlIHN0YWdlXG4gICAgLy8gcmVhZHMgdGhlIHdob2xlIGZpbGU6IGVtaXQgdGhlIHNhbWUgd2hvbGUtZmlsZSBzcGFuIGBnaXQgc2hvdyByZXY6cGF0aGBcbiAgICAvLyBwcm9kdWNlcy4gV2hlbiBhIHBpcGUgZm9sbG93cywgdGhlIGRvd25zdHJlYW0gbGluZS1zZWxlY3RvciBhbHJlYWR5XG4gICAgLy8gZW1pdHMgdGhlIHByZWNpc2UgcmFuZ2UsIHNvIHRoZSBzb3VyY2Ugc3RheXMgc291cmNlLW9ubHkuXG4gICAgaWYgKHBsYWluRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbmV4dCA9IHNpbXBsZUNvbW1hbmRzW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dC5wcmVjZWRlZEJ5ICE9PSAnfCcpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICAgIGlkaW9tOiBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZScsXG4gICAgICAgICAgICBmaWxlQXJnOiBwbGFpbkZpbGVBcmcsXG4gICAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICAgICAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgICAgICAgICB9LFxuICAgICAgICAgIGN1cnJlbnREaXIsXG4gICAgICAgICAgaSxcbiAgICAgICAgICBqb2luT2Yoc2ltcGxlKVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIFsuLi5MSU5FX1NFTEVDVE9SUywgbWF0Y2hHaXRTaG93LCBtYXRjaEdpdExvZ0xdKSB7XG4gICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcihhcmd2KSkge1xuICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICAvLyBgZ2l0IHNob3cgcmV2OnBhdGhgIHByaW50cyB0aGUgYmxvYiB2ZXJiYXRpbSwgc28gKHVubGlrZSBgZ2l0IGxvZyAtTGAsXG4gICAgICAgICAgLy8gd2hpY2ggcHJpbnRzIGRpZmYtZm9ybWF0dGVkIGhpc3RvcnkpIGl0J3MgYSB2YWxpZCBvbmUtaG9wIHBpcGUgc291cmNlXG4gICAgICAgICAgLy8gZm9yIGEgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yLCBzYW1lIGFzIGBjYXRgL2BubGAuXG4gICAgICAgICAgaWYgKG91dGNvbWUuaWRpb20gPT09ICdnaXQtc2hvdy1yZXYtcGF0aCcgJiYgIWxvb2tzVW5yZXNvbHZhYmxlKG91dGNvbWUuZmlsZUFyZykpIHtcbiAgICAgICAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IHJlc29sdmVQYXRoKG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgb3V0Y29tZS5maWxlQXJnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoZWQgJiYgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8JyAmJiBsYXN0UGxhaW5GaWxlU291cmNlKSB7XG4gICAgICBjb25zdCB3aXRoRmlsZSA9IFsuLi5hcmd2LCBsYXN0UGxhaW5GaWxlU291cmNlXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBMSU5FX1NFTEVDVE9SUykge1xuICAgICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcih3aXRoRmlsZSkpIHtcbiAgICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAnY2FuZGlkYXRlJykgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluU291cmNlKSBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNpbXBsZUNvbW1hbmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gc2ltcGxlQ29tbWFuZHNbaV07XG5cbiAgICAvLyBBIHBpcGUgc3RhZ2UgbWF5IGluaGVyaXQgdGhlIHByZXZpb3VzIHN0YWdlJ3MgbGl0ZXJhbCBlY2hvIGNvbnRlbnQ7IGFueVxuICAgIC8vIG90aGVyIGJvdW5kYXJ5IGNsZWFycyBpdC5cbiAgICBpZiAoc2ltcGxlLnByZWNlZGVkQnkgIT09ICd8JykgcGlwZUVjaG9Db250ZW50ID0gbnVsbDtcblxuICAgIGNvbnN0IGhlcmVkb2NSZWYgPSBzaW1wbGUudGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgY29uc3QgdyA9IGhlcmVkb2NXcml0ZXNbTnVtYmVyLnBhcnNlSW50KGhlcmVkb2NSZWZbMV0sIDEwKV07XG4gICAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyh3Lm9wZW5lcikudHJpbSgpKTtcbiAgICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgb3BlbmVyQXJndiA9IGFuYWx5emVUb2tlbnModG9rZW5zKS5hcmd2O1xuICAgICAgbWF0Y2hSZWFkcyhzaW1wbGUsIG9wZW5lckFyZ3YsIGkpO1xuICAgICAgY2xhc3NpZnlIZXJlZG9jT3BlbmVyKHcub3BlbmVyLCB3LmJvZHksIHcucXVvdGVkRGVsaW0sIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KG9wZW5lckFyZ3YpID8/IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGUudGV4dCkudHJpbSgpKTtcbiAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB7IGFyZ3YsIHJlZGlyZWN0cyB9ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpO1xuICAgIGlmIChhcmd2Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQmFyZSBgPiBmYCAvIGA6ID4gZmA6IG5vIGFyZ3YsIGJ1dCB0aGUgdHJ1bmNhdGlvbiBncmFtbWFyIHN0aWxsIGZpcmVzLlxuICAgICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoYXJndlswXSA9PT0gJ2NkJykge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb25zdCB0YXJnZXQgPSBhcmd2WzFdO1xuICAgICAgaWYgKHRhcmdldCAhPT0gdW5kZWZpbmVkICYmIHRhcmdldCAhPT0gJy0nICYmICFoYXNTaGVsbEV4cGFuc2lvbih0YXJnZXQpKSB7XG4gICAgICAgIGN1cnJlbnREaXIgPSByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgYmVmb3JlID0gcmVzdWx0cy5sZW5ndGg7XG4gICAgbWF0Y2hSZWFkcyhzaW1wbGUsIGFyZ3YsIGkpO1xuICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaENvcHlNb3ZlRmFtaWx5KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFJtVHJ1bmNhdGUoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoU2VkSW5wbGFjZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hQYXRjaEFwcGx5KGFyZ3YsIHJlZGlyZWN0cywgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoRm9ybWF0dGVyKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEdpdFJlc3RvcmVDaGVja291dChhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID09PSBiZWZvcmUpIHtcbiAgICAgIC8vIE5vIHNwYW4gZm9yIHRoaXMgY29tbWFuZDogYSBkZXRlcm1pbmlzdGljIGJ1aWx0aW4gaXMgc3RpbGwgYSB1c2FibGVcbiAgICAgIC8vIGpvaW4gZ3VhcmQgKGBmYWxzZSAmJiBlY2hvIHggPiBmYCBtdXN0IHNraXAgdGhlIGVjaG8pLiBBbnkgb3RoZXJcbiAgICAgIC8vIGNvbW1hbmQgc3RheXMgc3Bhbi1sZXNzIGFuZCB1bmtub3dhYmxlIFx1MjAxNCB0aGUgZHJpdmVyIGZhaWxzIG9wZW4uXG4gICAgICBjb25zdCBzdGF0dXMgPSBCVUlMVElOX0dVQVJEX1NUQVRVUy5nZXQoYXJndlswXSk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdidWlsdGluLWd1YXJkJyxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXg6IGksXG4gICAgICAgICAgam9pbjogam9pbk9mKHNpbXBsZSksXG4gICAgICAgICAgZXhpdFN0YXR1czogc3RhdHVzXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBwaXBlRWNob0NvbnRlbnQgPSBsaXRlcmFsQ29udGVudChhcmd2KSA/PyBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKiBQYXJzZXMgYSBCYXNoIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZStsaW5lLXJhbmdlIHNwYW5zIGl0IHN0YXRpY2FsbHksIHJlbGlhYmx5IHJlYWRzIG9yIHdyaXRlcy4gYGN3ZGAgZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgIFx1MjAxNCBwYXNzIHRoZSBob29rJ3Mgb3duIGBjd2RgIGZpZWxkIGZvciBjb3JyZWN0IHJlc29sdXRpb24gb2YgcmVsYXRpdmUgcGF0aHMgYW5kIGBjZGAvYGdpdCAtQ2AgdGFyZ2V0cywgYW5kIG9mIGBnaXQgc2hvd2AvYGdpdCBsb2cgLUxgIHJldmlzaW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgY29uc3Qgc3BhbnM6IFJlc29sdmVkU3BhbltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiBkZXRhaWxlZCkge1xuICAgIGlmIChtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJykgc3BhbnMucHVzaChtLnNwYW4pO1xuICB9XG4gIHJldHVybiBzcGFucztcbn1cbiIsICIvKipcbiAqIFRoZSBvbmx5IGltcHVyZSBiaXRzOiBjb3VudGluZyBsaW5lcyBvZiBhIHdvcmtpbmctdHJlZSBmaWxlLCBhbmQgb2YgYSBmaWxlXG4gKiBhcyBpdCBleGlzdGVkIGF0IGEgZ2l2ZW4gZ2l0IHJldmlzaW9uLiBCb3RoIHJldHVybiBudWxsIG9uIGFueSBmYWlsdXJlXG4gKiAobWlzc2luZyBmaWxlLCBiYWQgcmV2LCBub3QgYSBnaXQgcmVwbywgZXRjLikgaW5zdGVhZCBvZiB0aHJvd2luZyBcdTIwMTQgYVxuICogY29tbWFuZCB0aGF0IHN0YXRpY2FsbHkgbWF0Y2hlZCBhbiBpZGlvbSBidXQgcG9pbnRzIGF0IHNvbWV0aGluZyB0aGlzXG4gKiBtYWNoaW5lIGNhbid0IGN1cnJlbnRseSByZXNvbHZlIGlzIGEgbm9ybWFsLCBleHBlY3RlZCBvdXRjb21lLCBub3QgYSBidWcuXG4gKi9cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYSB3b3JraW5nLXRyZWUgZmlsZSwgb3IgbnVsbCBpZiBpdCBjYW4ndCBiZSByZWFkLiBUcmFpbGluZyBuZXdsaW5lIGRvZXMgbm90IGNvdW50IGFzIGFuIGV4dHJhIGVtcHR5IGxpbmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNGaWxlKCkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICAgIGlmIChjb250ZW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IGNvbnRlbnQuZW5kc1dpdGgoJ1xcbicpID8gY29udGVudC5zbGljZSgwLCAtMSkgOiBjb250ZW50O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYHBhdGhgIGFzIGl0IGV4aXN0cyBhdCBgcmV2YCwgcnVuIGZyb20gYGN3ZGAsIG9yIG51bGwgaWYgdGhlIHJldi9wYXRoL3JlcG8gZG9lc24ndCByZXNvbHZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50R2l0QmxvYkxpbmVzKGN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3Nob3cnLCBgJHtyZXZ9OiR7cGF0aH1gXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgaWYgKG91dC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBvdXQuZW5kc1dpdGgoJ1xcbicpID8gb3V0LnNsaWNlKDAsIC0xKSA6IG91dDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgIi8qKlxuICogSGV1cmlzdGljLCBkZXBlbmRlbmN5LWZyZWUgc2hlbGwgc3BsaXR0aW5nLiBOb3QgYSBmdWxsIHNoZWxsIHBhcnNlciBcdTIwMTQgZ29vZFxuICogZW5vdWdoIHRvIGxvY2F0ZSBzaW1wbGUgY29tbWFuZHMgKGFuZCB0aGVpciBhcmd2KSBpbnNpZGUgYSBsYXJnZXJcbiAqICYmL3x8LzsvfC1qb2luZWQgQmFzaCBzdHJpbmcgd2l0aG91dCBwdWxsaW5nIGluIGEgcmVhbCBiYXNoIEFTVCBwYXJzZXIuXG4gKiBWYWxpZGF0ZWQgZHVyaW5nIHJlc2VhcmNoIGFnYWluc3QgYmFzaGxleCBvbiB0aGUgcmVhbCB0cmFuc2NyaXB0IGNvcnB1cztcbiAqIHRoaXMgcG9ydHMgdGhlIHNhbWUgYWxnb3JpdGhtLlxuICpcbiAqIFRoZSB3b3JkLWxldmVsIHRva2VuaXplciAoW3Rva2VuaXplXSkgaXMgcXVvdGUtIGFuZCByZWRpcmVjdC1hd2FyZSAocGxhblxuICogXHUwMEE3NS4xMCk6IHJlZGlyZWN0IG9wZXJhdG9ycyBhcmUgc3BsaXQgYXMgZGlzdGluY3QgdG9rZW5zIHdpdGggYXR0YWNoZWQtdGFyZ2V0XG4gKiBmb3JtcyBwcmVzZXJ2ZWQgKGA+ZmApLCBxdW90ZWQgdG9rZW5zIGFyZSB3b3JkcyBhbmQgbmV2ZXIgb3BlcmF0b3JzLCBhbmRcbiAqIFthcmd2T2ZdIGRlcml2ZXMgb3BlcmFuZHMgZnJvbSB0aGUgdG9rZW4gc3RyZWFtIG1pbnVzIHJlZGlyZWN0IHRva2VucyBhbmRcbiAqIHRoZWlyIHRhcmdldHMuXG4gKi9cblxuLyoqIE9uZSBgc2ltcGxlIGNvbW1hbmRgIGZvdW5kIGluIGEgbGFyZ2VyIHNjcmlwdCwgcGx1cyB3aGljaCBvcGVyYXRvciBwcmVjZWRlZCBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2ltcGxlQ29tbWFuZCB7XG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBvcGVyYXRvciBpbW1lZGlhdGVseSBiZWZvcmUgdGhpcyBjb21tYW5kOiAnfCcgZm9yIGEgcGlwZWxpbmUgc3RhZ2UsXG4gICAqICcmJicvJ3x8JyBmb3IgdGhlIGNvbmRpdGlvbmFsIG9wZXJhdG9ycyAodGhlIG9ubHkgb25lcyB0aGF0IGdhdGUsIHBsYW5cbiAgICogXHUwMEE3MyBzdGVwIDIpLCAnb3RoZXInIGZvciAnOycvbmV3bGluZS8nJicsIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kLlxuICAgKi9cbiAgcHJlY2VkZWRCeTogJ3N0YXJ0JyB8ICd8JyB8ICcmJicgfCAnfHwnIHwgJ290aGVyJztcbn1cblxuLyoqIFNwbGl0IGEgY29tbWFuZCBzdHJpbmcgaW50byBzaW1wbGUtY29tbWFuZCBzdWJzdHJpbmdzIGF0IHRvcC1sZXZlbCAmJiwgfHwsIDssIHwsIHwmLCBhbmQgbmV3bGluZSBib3VuZGFyaWVzLiBRdW90ZXMgYW5kICQoKS9gYC8oKSBuZXN0aW5nIGFyZSByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTaW1wbGVDb21tYW5kW10ge1xuICBjb25zdCBwYXJ0czogU2ltcGxlQ29tbWFuZFtdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gY21kLmxlbmd0aDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgcGVuZGluZ09wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10gPSAnc3RhcnQnO1xuXG4gIGNvbnN0IGZsdXNoID0gKG5leHRPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcGVuZGluZ09wID0gbmV4dE9wO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBvcGVyYXRvciBjdXJyZW50bHkgcGVuZGluZyBpcyBhIHBpcGUgKGB8YC9gfCZgKS4gQSBoZWxwZXJcbiAgICogcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQncyBjb250cm9sLWZsb3cgbmFycm93aW5nXG4gICAqIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG8gYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzXG4gICAqIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZSBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGVcbiAgICogaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNQZW5kaW5nUGlwZSA9ICgpOiBib29sZWFuID0+IHBlbmRpbmdPcCA9PT0gJ3wnO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgYnVmICs9IGNtZFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgYnVmICs9IGMgKyBjbWRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnJiYnKSB7XG4gICAgICAgIGZsdXNoKCcmJicpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8fCcpIHtcbiAgICAgICAgZmx1c2goJ3x8Jyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3wmJykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAvLyBBIG5ld2xpbmUgaW1tZWRpYXRlbHkgYWZ0ZXIgYSBwaXBlIG9wZXJhdG9yIGlzIGEgbGluZSBjb250aW51YXRpb25cbiAgICAgICAgLy8gKGBjYXQgYS50eHQgfFxcbnNlZCAuLi5gIGtlZXBzIHRoZSBwaXBlbGluZSksIG5vdCBhIHN0YXRlbWVudFxuICAgICAgICAvLyBzZXBhcmF0b3I6IHNraXBwaW5nIGl0IHByZXNlcnZlcyBgcHJlY2VkZWRCeTogJ3wnYCBmb3IgdGhlIG5leHRcbiAgICAgICAgLy8gc3RhZ2UgaW5zdGVhZCBvZiBkZWdyYWRpbmcgaXQgdG8gJ290aGVyJy5cbiAgICAgICAgaWYgKGlzUGVuZGluZ1BpcGUoKSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgICAgLy8gYCY+YC9gJj4+YCAoc3Rkb3V0K3N0ZGVyciByZWRpcmVjdCkgYW5kIGA+JmAgKGZkLWR1cCByZWRpcmVjdCwgYXMgaW5cbiAgICAgICAgLy8gYDI+JjFgKSBhcmUgcmVkaXJlY3Qgb3BlcmF0b3JzLCBub3QgY29tbWFuZCBzZXBhcmF0b3JzIFx1MjAxNCBrZWVwIHRoZW1cbiAgICAgICAgLy8gaW4gdGhlIGN1cnJlbnQgc2ltcGxlIGNvbW1hbmQgc28gdGhlIHRva2VuaXplciBjYW4gbGV4IHRoZW0gYXMgb25lXG4gICAgICAgIC8vIHRva2VuLiBBIGA+YCBjb3VudHMgYXMgYSBkdXAtcmVkaXJlY3QgcHJlZml4IG9ubHkgYXQgYSB0b2tlblxuICAgICAgICAvLyBib3VuZGFyeSAoc3RhcnQsIG9yIGFmdGVyIHdoaXRlc3BhY2UvZGlnaXRzKSBcdTIwMTQgYGE+YiZjYCBzdGlsbFxuICAgICAgICAvLyBiYWNrZ3JvdW5kcyB0aGUgYGE+YmAgcmVkaXJlY3QuXG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBidWYudHJpbUVuZCgpO1xuICAgICAgICBsZXQgZHVwUmVkaXJlY3QgPSBmYWxzZTtcbiAgICAgICAgaWYgKHRyaW1tZWQuZW5kc1dpdGgoJz4nKSkge1xuICAgICAgICAgIGNvbnN0IGJlZm9yZSA9IHRyaW1tZWQubGVuZ3RoID49IDIgPyB0cmltbWVkW3RyaW1tZWQubGVuZ3RoIC0gMl0gOiAnJztcbiAgICAgICAgICBkdXBSZWRpcmVjdCA9IHRyaW1tZWQubGVuZ3RoID09PSAxIHx8IC9cXHN8XFxkLy50ZXN0KGJlZm9yZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZFtpICsgMV0gPT09ICc+JyB8fCBkdXBSZWRpcmVjdCkge1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGZsdXNoKCdvdGhlcicpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbmNvbnN0IExFQURJTkdfQVNTSUdOTUVOVCA9IC9eKD86W0EtWmEtel9dW0EtWmEtejAtOV9dKj1cXFMqXFxzKykrLztcblxuLyoqIFN0cmlwIGxlYWRpbmcgRk9PPWJhciBWQVI9YmF6IGVudi1wcmVmaXggYXNzaWdubWVudHMgZnJvbSBhIHNpbXBsZSBjb21tYW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNpbXBsZUNtZC5yZXBsYWNlKExFQURJTkdfQVNTSUdOTUVOVCwgJycpO1xufVxuXG4vKiogT25lIHF1b3RlLWF3YXJlIGxleGljYWwgdG9rZW4gZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgdGV4dCAocGxhbiBcdTAwQTc1LjEwKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9rZW4ge1xuICAvKipcbiAgICogVGhlIHRva2VuIHRleHQuIFdvcmQgdG9rZW5zIGhhdmUgcXVvdGVzIHN0cmlwcGVkIGFuZCBlc2NhcGVzIHJlc29sdmVkO1xuICAgKiByZWRpcmVjdCB0b2tlbnMga2VlcCB0aGUgb3BlcmF0b3Igd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IChgPmZgLFxuICAgKiBgPj5mYCksIHNoZWxsLWxleGVyIHN0eWxlLlxuICAgKi9cbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gd2FzIHF1b3RlZCBvciBlc2NhcGVkIGFueXdoZXJlIGluIHRoZSBzb3VyY2UuIEEgcXVvdGVkXG4gICAqIHRva2VuIGlzIGEgd29yZCwgbmV2ZXIgYW4gb3BlcmF0b3IgKGBlY2hvICc+J2AgaXMgbm90IGEgcmVkaXJlY3QpLlxuICAgKi9cbiAgcXVvdGVkOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gaXMgYSByZWRpcmVjdCBvcGVyYXRvciAoYD5gLCBgPj5gLCBgMT5gLCBgMj5gLCBgJj5gLFxuICAgKiBgJj4+YCwgYD4mYCwgYDxgLCBgPDxgLCBgPDwtYCwgYDw8PGApLCB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgcHJlc2VydmVkXG4gICAqIGluIGB0ZXh0YC5cbiAgICovXG4gIGlzUmVkaXJlY3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgdG9rZW5pemVyIHRoYXQgc3BsaXRzIHJlZGlyZWN0IG9wZXJhdG9ycyBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aFxuICogYXR0YWNoZWQtdGFyZ2V0IGZvcm1zIHByZXNlcnZlZCAocGxhbiBcdTAwQTc1LjEwKS4gV29yZCB0b2tlbnMgY2FycnkgdGhlXG4gKiBgcXVvdGVkYCBmbGFnIHNvIGNvbnN1bWVycyBjYW4gdGVsbCBhIHJlYWwgYDw8YCBvcGVyYXRvciBmcm9tIGEgcXVvdGVkXG4gKiBgXCI8PFwiYCBsaXRlcmFsLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbml6ZShzOiBzdHJpbmcpOiBUb2tlbltdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VuczogVG9rZW5bXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gcy5sZW5ndGg7XG5cbiAgY29uc3QgZmx1c2hXb3JkID0gKCk6IHZvaWQgPT4ge1xuICAgIGlmIChidWYubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYsIHF1b3RlZCwgaXNSZWRpcmVjdDogZmFsc2UgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgdW5xdW90ZWQgY29udGVudCBvZiB0aGUgcXVvdGVkIHNlY3Rpb24gb3BlbmluZyBhdCBgc3RhcnRgXG4gICAqICh0aGUgcXVvdGUgY2hhcikgdG8gYG91dGAsIG1pcnJvcmluZyBzaGxleCdzIGVzY2FwZSBydWxlcyBmb3IgZG91YmxlXG4gICAqIHF1b3Rlcy4gUmV0dXJucyB0aGUgaW5kZXggYWZ0ZXIgdGhlIGNsb3NpbmcgcXVvdGUsIG9yIG51bGwgd2hlblxuICAgKiB1bmJhbGFuY2VkLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kUXVvdGVkQ29udGVudCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgY29uc3QgcXVvdGUgPSBzW3N0YXJ0XTtcbiAgICBsZXQgaiA9IHN0YXJ0ICsgMTtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKHF1b3RlID09PSBcIidcIikge1xuICAgICAgICBpZiAoYyA9PT0gXCInXCIpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGogKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaiArIDFdKSkge1xuICAgICAgICBvdXQgKz0gc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHJhdyBhdHRhY2hlZC10YXJnZXQgdGV4dCBzdGFydGluZyBhdCBgc3RhcnRgIHRvIGBvdXRgIFx1MjAxNFxuICAgKiB2ZXJiYXRpbSwgcXVvdGVkIHNlY3Rpb25zIHNwYW5uaW5nIHNwYWNlcyBpbmNsdWRlZCBcdTIwMTQgc3RvcHBpbmcgYXRcbiAgICogd2hpdGVzcGFjZSBvciBhbm90aGVyIHJlZGlyZWN0IG9wZXJhdG9yLiBSZXR1cm5zIHRoZSBuZXh0IGluZGV4LCBvciBudWxsXG4gICAqIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kQXR0YWNoZWRUYXJnZXQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBqID0gc3RhcnQ7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpIHx8IGMgPT09ICc8JyB8fCBjID09PSAnPicpIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoJycsIGopO1xuICAgICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICAgIG91dCArPSBzLnNsaWNlKGosIHNlY3Rpb24ubmV4dCk7XG4gICAgICAgIGogPSBzZWN0aW9uLm5leHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4pIHtcbiAgICAgICAgb3V0ICs9IGMgKyBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgfTtcblxuICAvKiogRW1pdCBhIHJlZGlyZWN0IHRva2VuIHdob3NlIHRleHQgcHJlZml4ZXMgdGhlIG9wZXJhdG9yIHdpdGggdGhlIGN1cnJlbnQgZGlnaXQgYnVmZmVyIChhbiBJT19OVU1CRVIgbGlrZSBgMj5gKS4gKi9cbiAgY29uc3QgZW1pdFJlZGlyZWN0ID0gKG9wZXJhdG9yOiBzdHJpbmcsIGF0dGFjaGVkU3RhcnQ6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGF0dGFjaGVkID0gYXBwZW5kQXR0YWNoZWRUYXJnZXQoJycsIGF0dGFjaGVkU3RhcnQpO1xuICAgIGlmIChhdHRhY2hlZCA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmICsgb3BlcmF0b3IgKyBhdHRhY2hlZC5vdXQsIHF1b3RlZDogZmFsc2UsIGlzUmVkaXJlY3Q6IHRydWUgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gICAgaSA9IGF0dGFjaGVkLm5leHQ7XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoYnVmLCBpKTtcbiAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgIGJ1ZiA9IHNlY3Rpb24ub3V0O1xuICAgICAgaSA9IHNlY3Rpb24ubmV4dDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnIHx8IGMgPT09ICc+Jykge1xuICAgICAgLy8gQSBgPGAvYD5gIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgYXQgYSB3b3JkIGJvdW5kYXJ5LCBvciBhZnRlciBhblxuICAgICAgLy8gSU9fTlVNQkVSIGRpZ2l0IHJ1biAoYDE+YCwgYDI+YCk7IG1pZC13b3JkIGl0IGVuZHMgdGhlIGN1cnJlbnQgd29yZFxuICAgICAgLy8gZmlyc3QgKGBlY2hvIGE+YmAgXHUyMTkyIHdvcmRzIGBlY2hvYCwgYGFgOyByZWRpcmVjdCBgPmJgKS5cbiAgICAgIGlmIChidWYgIT09ICcnICYmICEvXlxcZCskLy50ZXN0KGJ1ZikpIGZsdXNoV29yZCgpO1xuICAgICAgbGV0IG9wZXJhdG9yOiBzdHJpbmc7XG4gICAgICBpZiAoYyA9PT0gJzwnKSB7XG4gICAgICAgIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8PCcpIG9wZXJhdG9yID0gJzw8PCc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDwtJykgb3BlcmF0b3IgPSAnPDwtJztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMikgPT09ICc8PCcpIG9wZXJhdG9yID0gJzw8JztcbiAgICAgICAgZWxzZSBvcGVyYXRvciA9ICc8JztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMikgPT09ICc+PicgPyAnPj4nIDogJz4nO1xuICAgICAgfVxuICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIFx1MjAxNCB0aGUgc3Rkb3V0K3N0ZGVyciByZWRpcmVjdCAoa2VwdCB0b2dldGhlciBieVxuICAgICAgLy8gc3BsaXRUb3BMZXZlbCkuIEEgYmFyZSBgJmAgaGVyZSBpcyBhbiBvcmRpbmFyeSB3b3JkIGNoYXIgKGAmMWAgaW5cbiAgICAgIC8vIGAyPiYxYCwgd2hpY2ggdGhlIGF0dGFjaGVkLXRhcmdldCBzY2FuIGFib3ZlIGNvbnN1bWVkIGFueXdheSkuXG4gICAgICBpZiAoc1tpICsgMV0gPT09ICc+Jykge1xuICAgICAgICBmbHVzaFdvcmQoKTtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAzKSA9PT0gJyY+PicgPyAnJj4+JyA6ICcmPic7XG4gICAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGZsdXNoV29yZCgpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKipcbiAqIFRoZSBhdHRhY2hlZCB0YXJnZXQgb2YgYSByZWRpcmVjdCB0b2tlbiwgb3IgbnVsbCB3aGVuIHRoZSBvcGVyYXRvciBpc1xuICogc3RhbmRhbG9uZSAoYD5gIHZzIGA+ZmA7IGAyPmAgdnMgYDI+JjFgKS4gU3BsaXRzIGFuIG9wdGlvbmFsIElPX05VTUJFUlxuICogZGlnaXQgcnVuIG9mZiB0aGUgZnJvbnQsIHRoZW4gdGhlIG9wZXJhdG9yLCBsZWF2aW5nIHRoZSB0YXJnZXQuXG4gKi9cbmZ1bmN0aW9uIHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodGV4dDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdGV4dC5tYXRjaCgvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvKTtcbiAgaWYgKG1hdGNoID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgLCAsIHJlc3RdID0gbWF0Y2g7XG4gIHJldHVybiByZXN0Lmxlbmd0aCA+IDAgPyByZXN0IDogbnVsbDtcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHRva2VucyBtaW51cyByZWRpcmVjdCBvcGVyYXRvcnMgYW5kIHRoZWlyIHRhcmdldHMuIFJldHVybnMgbnVsbCBpZiB0aGUgY29tbWFuZCBkb2Vzbid0IHRva2VuaXplIGNsZWFubHkgKHVuYmFsYW5jZWQgcXVvdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcmd2T2Yoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEEgc3RhbmRhbG9uZSByZWRpcmVjdCBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0O1xuICAgIC8vIGFuIGF0dGFjaGVkIGZvcm0gKGA+ZmAsIGA+PmZgKSBpcyBzZWxmLWNvbnRhaW5lZC5cbiAgICBpZiAocmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0b2tlbi50ZXh0KSA9PT0gbnVsbCkgaSArPSAxO1xuICB9XG4gIHJldHVybiBhcmd2O1xufVxuIiwgIi8qKlxuICogVGhlIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAocGxhbiBcdTAwQTc1LjcpLCBzaWJsaW5nIHRvXG4gKiBtZWNoYW5pY2FsLWNoYW5nZS50cydzIHJhbmdlLWxlc3MgYHBhcnNlVW5pZmllZERpZmZgLiBUaGUgcGF0Y2gvZ2l0IGFwcGx5XG4gKiBncmFtbWFyIG5lZWRzIHRoZSBgQEAgLWEsYiArYyxkIEBAYCBodW5rIG51bWJlcnMgdGhhdCBwYXJzZVVuaWZpZWREaWZmXG4gKiBkaXNjYXJkcywgc28gdGhpcyBwYXJzZXMgdGhlIHNhbWUgaGVhZGVyIGRpYWxlY3QgZnJvbSBzY3JhdGNoLlxuICpcbiAqIEEgaHVuayB3aG9zZSBwcmUvcG9zdCBsaW5lIGNvdW50cyBtYXRjaCBwcmVzZXJ2ZXMgbGluZSBjb29yZGluYXRlcywgc28gYVxuICogZmlsZSB3aG9zZSBodW5rcyBhcmUgYWxsIGNvdW50LXByZXNlcnZpbmcgZ2V0cyBhbiBleGFjdCByYW5nZSBcdTIwMTQgdGhlIHVuaW9uIG9mXG4gKiBldmVyeSBodW5rJ3MgcmVnaW9uLiBBbnkgY291bnQtY2hhbmdpbmcgaHVuayAocHVyZSBhZGQsIHB1cmUgZGVsZXRlLCB1bmVxdWFsXG4gKiBjb3VudHMpIGRlZ3JhZGVzIHRoZSBmaWxlIHRvIGEgd2hvbGUtZmlsZSBtb2RpZnk6IHBvc2l0aW9ucyBiZWxvdyBpdCBzaGlmdCxcbiAqIGFuZCBhIGRlbGV0ZWQgbGluZSBvY2N1cGllcyBubyBwb3N0LWVkaXQgcmFuZ2UgYXQgYWxsLlxuICpcbiAqIFBlci1maWxlIGNsYXNzaWZpY2F0aW9uczogYG5ldyBmaWxlIG1vZGVgIFx1MjE5MiBjcmVhdGUtb3ZlcndyaXRlOyBgZGVsZXRlZCBmaWxlXG4gKiBtb2RlYCBcdTIxOTIgZGVsZXRlOyBgcmVuYW1lIGZyb21gL2ByZW5hbWUgdG9gIFx1MjE5MiBzb3VyY2UgZGVsZXRlICsgZGVzdFxuICogcmVuYW1lLWNvcHk7IGJpbmFyeSBkaWZmcyBcdTIxOTIgd2hvbGUtZmlsZSBtb2RpZnk7IGEgYCsrKyAvZGV2L251bGxgIHRhcmdldCAodGhlXG4gKiBzaGFwZSBgZGlmZiAtdWAtZm9ybWF0IGRlbGV0aW9ucyB0YWtlKSBcdTIxOTIgZGVsZXRlLlxuICpcbiAqIEdpdC1zdHlsZSBgYS9cdTIwMjZgL2BiL1x1MjAyNmAgcHJlZml4ZXMgYXJlIHN0cmlwcGVkIHBlciB0aGUgY2FsbGVyJ3MgYC1wTmAgc3RyaXBcbiAqIGxldmVsOiBhIG51bWJlciBzdHJpcHMgdGhhdCBtYW55IGxlYWRpbmcgcGF0aCBjb21wb25lbnRzLCBhbmQgYCdhdXRvJ2BcbiAqIChwYXRjaCdzIGRlZmF1bHQpIHN0cmlwcyBvbmUgd2hlbiB0aGUgcGF0aCBpcyBhLy0gb3IgYi8tcHJlZml4ZWQgYW5kIG5vbmVcbiAqIG90aGVyd2lzZS4gYC9kZXYvbnVsbGAgaXMgY2hlY2tlZCBiZWZvcmUgc3RyaXBwaW5nIFx1MjAxNCB0aGUgaGVhZGVyIG1hcmtlclxuICogd291bGQgb3RoZXJ3aXNlIGxvc2UgaXRzIGBkZXYvYCBjb21wb25lbnQuXG4gKlxuICogYGRpZmYgLXVgIGhlYWRlcnMgY2FycnkgYSB0YWItc2VwYXJhdGVkIHRpbWVzdGFtcCAoYC0tLSBmLnR4dFxcdDIwMjQtMDEtMDFcbiAqIDAwOjAwOjAwYCkgYW5kIG1heSBiZSBDUkxGLXRlcm1pbmF0ZWQ7IGJvdGggYXJlIHN0cmlwcGVkIGJlZm9yZSBwYXRoXG4gKiByZXNvbHV0aW9uLiBUaGUgdGFyZ2V0IG9mIGEgbW9kaWZ5IGh1bmsgaXMgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXRcbiAqIGFwcGx5IHJld3JpdGUgdGhlIGZpbGUgbmFtZWQgdGhlcmUgKGZvciBgZGlmZiAtdSBmLnR4dCBmLm5ld2AsIHRoZSBgKysrYFxuICogc2lkZSBpcyBvbmx5IGEgbGFiZWwpLCBzbyB0aGUgYCsrK2AgbGluZSBvdmVycmlkZXMgdGhlIHBhdGggb25seSBmb3IgdGhlXG4gKiBgL2Rldi9udWxsYCBtYXJrZXJzIFx1MjAxNCBhIGAtLS0gL2Rldi9udWxsYCBzaWRlIChhIG5ldyBmaWxlKSBuYW1lcyB0aGUgdGFyZ2V0XG4gKiBvbiBgKysrYCwgYW5kIGEgYCsrKyAvZGV2L251bGxgIHNpZGUgbWFya3MgYSBkZWxldGlvbi5cbiAqXG4gKiBNYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCByZXR1cm5zIG51bGwgKGZhaWwgY2xvc2VkIFx1MjAxNCB0aGUgY2FsbGVyIGVtaXRzXG4gKiB1bnJlc29sdmVkIHJhdGhlciB0aGFuIGd1ZXNzaW5nIGF0IHRhcmdldHMpLlxuICovXG5cbi8qKiBUaGUgYC1wTmAgaGVhZGVyIHN0cmlwIGxldmVsOiBhIGNvbXBvbmVudCBjb3VudCwgb3IgcGF0Y2gncyBgJ2F1dG8nYCBkZWZhdWx0LiAqL1xuZXhwb3J0IHR5cGUgUGF0aFN0cmlwID0gbnVtYmVyIHwgJ2F1dG8nO1xuXG4vKiogT25lIGZpbGUgYSBwYXRjaCB0b3VjaGVzOiB0aGUgdGFyZ2V0IHBhdGgsIHRoZSB0b3VjaCBraW5kLCBhbmQgdGhlIGV4YWN0IHJhbmdlIHdoZW4gdGhlIGh1bmtzIHByZXNlcnZlIGxpbmUgY291bnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVbmlmaWVkRGlmZlRhcmdldCB7XG4gIHBhdGg6IHN0cmluZztcbiAgb3BlcmF0aW9uOiAnbW9kaWZ5JyB8ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdkZWxldGUnIHwgJ3JlbmFtZS1jb3B5JztcbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xufVxuXG5jb25zdCBIVU5LX0hFQURFUiA9IC9eQEAgLShcXGQrKSg/OiwoXFxkKykpPyBcXCsoXFxkKykoPzosKFxcZCspKT8gQEAvO1xuXG4vKiogU3RyaXAgdGhlIGZpcnN0IGBuYCBsZWFkaW5nIHBhdGggY29tcG9uZW50cyAoYC1wTmApLCBzdG9wcGluZyBhdCBhIGNvbXBvbmVudC1sZXNzIHBhdGguICovXG5mdW5jdGlvbiBzdHJpcFBhdGhDb21wb25lbnRzKHA6IHN0cmluZywgbjogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IHMgPSBwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGNvbnN0IHNsYXNoID0gcy5pbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoID09PSAtMSkgcmV0dXJuIHM7XG4gICAgcyA9IHMuc2xpY2Uoc2xhc2ggKyAxKTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuLyoqXG4gKiBUaGUgbGV2ZWwgdG8gc3RyaXAgZnJvbSBgcmF3YCB1bmRlciBgc3RyaXBgOiBhIG51bWJlciBwYXNzZXMgdGhyb3VnaDsgYCdhdXRvJ2BcbiAqIHJlc29sdmVzIHRvIHAxIHdoZW4gdGhlIHBhdGggaXMgYGEvYC9gYi9gLXByZWZpeGVkIGFuZCBwMCBvdGhlcndpc2UgXHUyMDE0IHBhdGNoJ3NcbiAqIGRlZmF1bHQgZm9yIGRpZmZzIHdob3NlIHByZWZpeGVzIGFyZSBgZGlmZiAtdWAtc3R5bGUgcmF0aGVyIHRoYW4gZ2l0J3MuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwTGV2ZWxGb3IocmF3OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBudW1iZXIge1xuICByZXR1cm4gc3RyaXAgPT09ICdhdXRvJyA/IChyYXcuc3RhcnRzV2l0aCgnYS8nKSB8fCByYXcuc3RhcnRzV2l0aCgnYi8nKSA/IDEgOiAwKSA6IHN0cmlwO1xufVxuXG4vKipcbiAqIFRoZSByYXcgYC0tLWAvYCsrK2AgaGVhZGVyIHBhdGg6IHRoZSB0ZXh0IHVwIHRvIHRoZSBmaXJzdCB0YWIgKHRoZVxuICogYGRpZmYgLXVgIHRpbWVzdGFtcCBjb2x1bW4pLCBvciB0aGUgd2hvbGUgd29yZCB3aGVuIHRoZXJlIGlzIG5vbmUuIENSTEZcbiAqIGlzIGhhbmRsZWQgYXQgdGhlIGxpbmUgbGV2ZWwgKHNlZSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UpLCB3aGljaCBhbHNvXG4gKiBjb3ZlcnMgaHVuayBoZWFkZXJzLlxuICovXG5mdW5jdGlvbiBoZWFkZXJQYXRoVGV4dChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRhYiA9IHJhdy5pbmRleE9mKCdcXHQnKTtcbiAgcmV0dXJuIHRhYiA9PT0gLTEgPyByYXcgOiByYXcuc2xpY2UoMCwgdGFiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQ6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IFVuaWZpZWREaWZmVGFyZ2V0W10gfCBudWxsIHtcbiAgY29uc3QgcmVzdWx0czogVW5pZmllZERpZmZUYXJnZXRbXSA9IFtdO1xuICBsZXQgc2F3QmxvY2sgPSBmYWxzZTtcbiAgbGV0IGN1cnJlbnQ6IHtcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAga2luZDogJ21vZGlmeScgfCAnbmV3JyB8ICdkZWxldGVkJztcbiAgICBodW5rczogQXJyYXk8eyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9PjtcbiAgICBjb3VudENoYW5naW5nOiBib29sZWFuO1xuICB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBwZW5kaW5nS2luZDogJ25ldycgfCAnZGVsZXRlZCcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZUZyb206IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lVG86IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgYmluYXJ5ID0gZmFsc2U7XG5cbiAgLyoqIFRoZSBoZWFkZXIgcGF0aCwgdGFiL0NSLXN0cmlwcGVkLCB3aXRoIHRoZSBgLXBOYCBsZXZlbCBhcHBsaWVkIFx1MjAxNCBgL2Rldi9udWxsYCBrZXB0IHZlcmJhdGltICh0aGUgbWFya2VyIGlzIG5ldmVyIGEgcmVhbCBwYXRoKS4gKi9cbiAgY29uc3Qgc3RyaXBwZWQgPSAocmF3OiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IHRleHQgPSBoZWFkZXJQYXRoVGV4dChyYXcpO1xuICAgIGlmICh0ZXh0ID09PSAnL2Rldi9udWxsJykgcmV0dXJuIHRleHQ7XG4gICAgcmV0dXJuIHN0cmlwUGF0aENvbXBvbmVudHModGV4dCwgc3RyaXBMZXZlbEZvcih0ZXh0LCBzdHJpcCkpO1xuICB9O1xuXG4gIGNvbnN0IGZpbmlzaCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGN1cnJlbnQua2luZCA9PT0gJ25ldycpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LmtpbmQgPT09ICdkZWxldGVkJykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgICAgZWxzZSBpZiAoYmluYXJ5KSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50Lmh1bmtzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBBIGhlYWRlci1vbmx5IGJsb2NrIHdpdGggbm8gaHVua3M6IG5vdGhpbmcgc3RhdGljYWxseSBrbm93bi5cbiAgICAgIH0gZWxzZSBpZiAoY3VycmVudC5jb3VudENoYW5naW5nKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbiguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5zdGFydCkpO1xuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heCguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5lbmQpKTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQgfSk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHJlbmFtZUZyb20gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZUZyb20sIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgaWYgKHJlbmFtZVRvICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVUbywgb3BlcmF0aW9uOiAncmVuYW1lLWNvcHknIH0pO1xuICAgIHJlbmFtZUZyb20gPSBudWxsO1xuICAgIHJlbmFtZVRvID0gbnVsbDtcbiAgICBiaW5hcnkgPSBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgcGF0Y2hUZXh0LnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEEgdHJhaWxpbmcgYFxccmAgKENSTEYgcGF0Y2ggdGV4dCBcdTIwMTQgV2luZG93cy1hdXRob3JlZCBkaWZmcykgcG9sbHV0ZXNcbiAgICAvLyBoZWFkZXJzLCBodW5rIGhlYWRlcnMsIGFuZCBwYXRoIGxpbmVzIGFsaWtlOyBib3RoIHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgICAvLyBzdHJpcCBpdCwgc28gdGhlIHBhcnNlciBkb2VzIHRvby5cbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS5lbmRzV2l0aCgnXFxyJykgPyByYXdMaW5lLnNsaWNlKDAsIC0xKSA6IHJhd0xpbmU7XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnLS0tICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkgZmluaXNoKCk7XG4gICAgICBjdXJyZW50ID0ge1xuICAgICAgICBwYXRoOiBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKSxcbiAgICAgICAga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsXG4gICAgICAgIGh1bmtzOiBbXSxcbiAgICAgICAgY291bnRDaGFuZ2luZzogZmFsc2VcbiAgICAgIH07XG4gICAgICBwZW5kaW5nS2luZCA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnKysrICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwYXRoID0gc3RyaXBwZWQobGluZS5zbGljZSg0KSk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgY3VycmVudCA9IHsgcGF0aCwga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsIGh1bmtzOiBbXSwgY291bnRDaGFuZ2luZzogZmFsc2UgfTtcbiAgICAgIGVsc2UgaWYgKHBhdGggPT09ICcvZGV2L251bGwnKSBjdXJyZW50LmtpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LnBhdGggPT09ICcvZGV2L251bGwnKSBjdXJyZW50LnBhdGggPSBwYXRoO1xuICAgICAgLy8gT3RoZXJ3aXNlIGtlZXAgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXQgYXBwbHkgcmV3cml0ZSB0aGUgZmlsZVxuICAgICAgLy8gbmFtZWQgb24gdGhlIGAtLS1gIGxpbmUsIGFuZCBgZGlmZiAtdSBmIGYubmV3YCBoZWFkZXJzIG5hbWUgdGhlXG4gICAgICAvLyBwcmUtaW1hZ2UgdGhlcmUgXHUyMDE0IHRoZSBgKysrYCBwYXRoIGlzIG9ubHkgYSBsYWJlbCAodGhlIGRpZmYtdXVcbiAgICAgIC8vIHBhdGNoLWhlYWRlciBtaXNzKS5cbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCduZXcgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ25ldyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnZGVsZXRlZCBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIHJlbmFtZUZyb20gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgZnJvbSAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSB0byAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgcmVuYW1lVG8gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgdG8gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykgfHwgbGluZS5zdGFydHNXaXRoKCdHSVQgYmluYXJ5IHBhdGNoJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGJpbmFyeSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaHVuayA9IGxpbmUubWF0Y2goSFVOS19IRUFERVIpO1xuICAgIGlmIChodW5rKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwcmVTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzFdLCAxMCk7XG4gICAgICBjb25zdCBwcmVDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICAgICAgY29uc3QgcG9zdENvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7IC8vIGEgaHVuayB3aXRob3V0IGEgZmlsZSBoZWFkZXIgXHUyMTkyIG1hbGZvcm1lZFxuICAgICAgaWYgKHByZUNvdW50ICE9PSBwb3N0Q291bnQpIGN1cnJlbnQuY291bnRDaGFuZ2luZyA9IHRydWU7XG4gICAgICBpZiAocHJlQ291bnQgPiAwKSBjdXJyZW50Lmh1bmtzLnB1c2goeyBzdGFydDogcHJlU3RhcnQsIGVuZDogcHJlU3RhcnQgKyBwcmVDb3VudCAtIDEgfSk7XG4gICAgfVxuICB9XG4gIGZpbmlzaCgpO1xuICByZXR1cm4gc2F3QmxvY2sgPyByZXN1bHRzIDogbnVsbDtcbn1cbiIsICIvKipcbiAqIENvZGV4IGBhcHBseV9wYXRjaGAgZW52ZWxvcGUgcGFyc2VyLlxuICpcbiAqIFR1cm5zIGEgQ29kZXggYGFwcGx5X3BhdGNoYCBgdG9vbF9pbnB1dC5jb21tYW5kYCBwYXRjaCBzdHJpbmcgaW50byB0aGVcbiAqIGBBbmNob3JTcGVjW11gIHNoYXBlIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBhbHJlYWR5IGNvbnN1bWVzIFx1MjAxNCB0aGUgb25lXG4gKiBnZW51aW5lbHkgbmV3IGFsZ29yaXRobSB0aGUgQ29kZXggYWRhcHRlciBuZWVkcy4gSXQgcmVwbGFjZXMgdGhlIHN0cnVjdHVyZWRcbiAqIGBmaWxlX3BhdGhgL2BvbGRfc3RyaW5nYC9gb2Zmc2V0YCByZWFkaW5nIHRoZSBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9va1xuICogZG9lcywgYmVjYXVzZSBDb2RleCBkZWxpdmVycyBldmVyeSBlZGl0IGFzIGEgc2luZ2xlIGFwcGx5X3BhdGNoIGVudmVsb3BlXG4gKiByYXRoZXIgdGhhbiBhIHR5cGVkIHRvb2wgaW5wdXQuXG4gKlxuICogVGhlIG1vZHVsZSBpcyBwdXJlOiBpdCBpbXBvcnRzIG9ubHkgdGhlIGtlcm5lbCBhbmNob3IgdHlwZXMgYW5kIG5ldmVyIHRvdWNoZXNcbiAqIHRoZSBDb2RleCBTREssIHNvIGl0IGlzIERJLXRlc3RhYmxlIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlXG4gKiBzaGFyZWQga2VybmVsLiBSYW5nZSByZWNvdmVyeSBpcyBiZXN0LWVmZm9ydCBcdTIwMTQgdGhlIGFwcGx5X3BhdGNoIGZvcm1hdCBjYXJyaWVzXG4gKiBgQEBgIGNvbnRleHQgYW5kIGArYC9gLWAvc3BhY2UgY2hhbmdlIGxpbmVzIGJ1dCBubyBleHBsaWNpdCBsaW5lIG51bWJlcnMsIHNvIGFcbiAqIHJhbmdlIGNhbiBvbmx5IGJlIHJlY292ZXJlZCBieSBsb2NhdGluZyBhIGh1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGVcbiAqIG9uLWRpc2sgZmlsZS4gVGhhdCBmaWxlIHJlYWQgaXMgaW5qZWN0ZWQgKGByZWFkUHJlRWRpdEZpbGVgKSBzbyB0aGUgZnVuY3Rpb25cbiAqIHN0YXlzIHB1cmUgYW5kIHRlc3RhYmxlLiBPbiBBTlkgYW1iaWd1aXR5IChubyByZWFkZXIsIGZpbGUgbWlzc2luZywgY29udGV4dFxuICogbm90IGZvdW5kLCBmdXp6eS9kdXBsaWNhdGUgbWF0Y2gpIHRoZSBwYXJzZXIgZGVncmFkZXMgdG8gYSB3aG9sZS1maWxlIGFuY2hvclxuICogcmF0aGVyIHRoYW4gdGhyb3dpbmcgXHUyMDE0IHdob2xlLWZpbGUgYW5jaG9ycyBhcmUgZmlyc3QtY2xhc3MgYW5kIHRvdWNoIHRyYWNraW5nXG4gKiBtdXN0IG5ldmVyIGJlIGJsb2NrZWQuXG4gKlxuICogVGhlIGdyYW1tYXIgaXMgY3Jvc3MtY2hlY2tlZCBhZ2FpbnN0IENvZGV4J3Mgb3duIGFwcGx5X3BhdGNoIGNyYXRlXG4gKiAoY29kZXgtcnMvYXBwbHktcGF0Y2gvc3JjL3twYXJzZXIsc3RyZWFtaW5nX3BhcnNlcn0ucnMpLiBUd28gc3VidGxldGllcyBhcmVcbiAqIG1pcnJvcmVkIGRlbGliZXJhdGVseTogaHVuay1oZWFkZXIgbWFya2VycyBhcmUgb25seSByZWNvZ25pemVkIGF0IHRoZSBzdGFydCBvZlxuICogYSBsaW5lIHdpdGggbm8gbGVhZGluZyB3aGl0ZXNwYWNlIHdoaWxlIGluc2lkZSBhbiBVcGRhdGUgaHVuayAoYSBsZWFkaW5nIHNwYWNlXG4gKiBkZW1vdGVzIGEgbWFya2VyIHRvIGEgY29udGV4dCBsaW5lKSwgYW5kIGEgYmFyZSBlbXB0eSBsaW5lIGluc2lkZSBhbiBVcGRhdGVcbiAqIGh1bmsgaXMgdHJlYXRlZCBhcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgcHJlc2VudCBpbiBib3RoIG9sZCBhbmQgbmV3IGNvbnRlbnQuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgdHlwZSB7IEFuY2hvclNwZWMsIExpbmVSYW5nZSB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuXG4vKipcbiAqIEFuIGFuY2hvciBwYXJzZWQgZnJvbSBhbiBhcHBseV9wYXRjaCBlbnZlbG9wZTogYW4ge0BsaW5rIEFuY2hvclNwZWN9IHBsdXNcbiAqIHRoZSBkZWxldGUgY2xhc3NpZmljYXRpb24gKHBsYW4gXHUwMEE3MykuIGAqKiogRGVsZXRlIEZpbGU6YCBodW5rcyBrZWVwIHRoZVxuICogYHdob2xlLXdyaXRlYCBraW5kIChUb3VjaEtpbmQgaXMgZml4ZWQpIGFuZCBhZGQgdGhlIGBhYnNlbnRgIG1hcmtlciBzbyB0aGVcbiAqIGFwcGx5X3BhdGNoIGNhbGwgc2l0ZSBwYXNzZXMgYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMDE0IHdpdGhvdXQgaXQgdGhlXG4gKiBkZWxldGlvbiB0b3VjaCB3b3VsZCBiZSBnYXRlZCBhd2F5IGJ5IHRoZSBgJ2V4aXN0cydgIGRlZmF1bHQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQYXRjaEFuY2hvciBleHRlbmRzIEFuY2hvclNwZWMge1xuICAvKiogdHJ1ZSBmb3IgYCoqKiBEZWxldGUgRmlsZTpgIGh1bmtzIFx1MjAxNCB0aGUgdG91Y2gncyB0YXJnZXRTdGF0ZSBpcyBgJ2Fic2VudCdgLiAqL1xuICBhYnNlbnQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJlYWRzIHRoZSBwcmUtZWRpdCAob24tZGlzaywgYmVmb3JlIHRoZSBwYXRjaCBhcHBsaWVzKSBjb250ZW50IG9mIHRoZSBmaWxlIGF0XG4gKiBgcGF0aGAsIG9yIHJldHVybnMgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIHJlYWQuIEluamVjdGVkIHNvIHRoZSBwYXJzZXIgc3RheXNcbiAqIHB1cmU7IGNhbGwgc2l0ZXMgZGVmYXVsdCB0byBhIHJlYWwgZmlsZXN5c3RlbSByZWFkLlxuICovXG5leHBvcnQgdHlwZSBSZWFkUHJlRWRpdEZpbGUgPSAocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdyYW1tYXIgbWFya2VycyAobWlycm9ycyBjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMvcGFyc2VyLnJzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IEVORF9QQVRDSF9NQVJLRVIgPSAnKioqIEVuZCBQYXRjaCc7XG5jb25zdCBBRERfRklMRV9NQVJLRVIgPSAnKioqIEFkZCBGaWxlOiAnO1xuY29uc3QgREVMRVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBEZWxldGUgRmlsZTogJztcbmNvbnN0IFVQREFURV9GSUxFX01BUktFUiA9ICcqKiogVXBkYXRlIEZpbGU6ICc7XG5jb25zdCBNT1ZFX1RPX01BUktFUiA9ICcqKiogTW92ZSB0bzogJztcbmNvbnN0IEVPRl9NQVJLRVIgPSAnKioqIEVuZCBvZiBGaWxlJztcbmNvbnN0IENIQU5HRV9DT05URVhUX01BUktFUiA9ICdAQCAnO1xuY29uc3QgRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJbnRlcm1lZGlhdGUgaHVuayBtb2RlbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBVcGRhdGVDaHVuayB7XG4gIC8qKiBPcHRpb25hbCBgQEAgPGNvbnRleHQ+YCBsaW5lIHVzZWQgdG8gZGlzYW1iaWd1YXRlIHRoZSBibG9jaydzIGxvY2F0aW9uLiAqL1xuICBjaGFuZ2VDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKiogUHJlLWVkaXQgbGluZXMgdGhpcyBjaHVuayBjb3ZlcnMgKGNvbnRleHQgYCBgICsgcmVtb3ZlZCBgLWApLCBpbiBvcmRlci4gKi9cbiAgb2xkTGluZXM6IHN0cmluZ1tdO1xuICAvKiogUG9zdC1lZGl0IGxpbmVzIChjb250ZXh0IGAgYCArIGFkZGVkIGArYCk7IHJldGFpbmVkIGZvciBjb21wbGV0ZW5lc3MuICovXG4gIG5ld0xpbmVzOiBzdHJpbmdbXTtcbn1cblxudHlwZSBIdW5rID1cbiAgfCB7IGtpbmQ6ICdhZGQnOyBwYXRoOiBzdHJpbmcgfVxuICB8IHsga2luZDogJ2RlbGV0ZSc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAndXBkYXRlJzsgcGF0aDogc3RyaW5nOyBtb3ZlUGF0aDogc3RyaW5nIHwgbnVsbDsgY2h1bmtzOiBVcGRhdGVDaHVua1tdIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCByZWFkZXJcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlYWwtZmlsZXN5c3RlbSByZWFkZXIgdXNlZCB3aGVuIG5vIHJlYWRlciBpcyBpbmplY3RlZC4gQmVzdC1lZmZvcnQ6IGFueVxuICogZmFpbHVyZSAobWlzc2luZyBmaWxlLCBwZXJtaXNzaW9uIGVycm9yKSB5aWVsZHMgYG51bGxgLCB3aGljaCB0aGUgcGFyc2VyXG4gKiBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFJlYWRQcmVFZGl0RmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMucmVhZEZpbGVTeW5jKHBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEVudmVsb3BlIHNjYW5uaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTY2FuIHRoZSBwYXRjaCB0ZXh0IGludG8gaHVua3MuIExlbmllbnQgYnkgZGVzaWduOiB1bnJlY29nbml6ZWQgbGluZXMgYXJlXG4gKiBpZ25vcmVkIHJhdGhlciB0aGFuIHJlamVjdGVkLCBhbmQgQmVnaW4vRW5kL0Vudmlyb25tZW50IGxpbmVzIGFyZSBza2lwcGVkLCBzb1xuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUgZGVncmFkZXMgdG8gd2hhdGV2ZXIgaHVua3MgY291bGQgYmUgcmVjb3ZlcmVkIChvZnRlblxuICogbm9uZSBcdTIxOTIgYFtdYCkgaW5zdGVhZCBvZiB0aHJvd2luZy5cbiAqL1xuZnVuY3Rpb24gc2Nhbkh1bmtzKGNvbW1hbmQ6IHN0cmluZyk6IEh1bmtbXSB7XG4gIGNvbnN0IGh1bmtzOiBIdW5rW10gPSBbXTtcbiAgLy8gVGhlIGN1cnJlbnRseS1vcGVuIFVwZGF0ZSBodW5rLCBvciBudWxsLiBBZGQvRGVsZXRlIGh1bmtzIGhhdmUgbm8gYm9keSwgc29cbiAgLy8gdGhleSBjbG9zZSBpbW1lZGlhdGVseSBhbmQgcmVzZXQgdGhpcyB0byBudWxsLlxuICBsZXQgb3BlblVwZGF0ZTogKEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pIHwgbnVsbCA9IG51bGw7XG5cbiAgZm9yIChjb25zdCByYXcgb2YgY29tbWFuZC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBIZWFkZXIgZGV0ZWN0aW9uIGlzIHdoaXRlc3BhY2Utc2Vuc2l0aXZlIGluc2lkZSBhbiBVcGRhdGUgaHVuazogQ29kZXggdXNlc1xuICAgIC8vIHRyaW1fZW5kIHRoZXJlIChsZWFkaW5nIHNwYWNlIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpIGFuZCBmdWxsXG4gICAgLy8gdHJpbSBlbHNld2hlcmUuIE1hdGNoIHRoYXQgc28gaW5kZW50ZWQgbWFya2VycyBpbnNpZGUgYSBodW5rIHN0YXkgY29udGVudC5cbiAgICBjb25zdCBoZWFkZXJMaW5lOiBzdHJpbmcgPSBvcGVuVXBkYXRlID8gcmF3LnJlcGxhY2UoL1sgXFx0XFxyXSskLywgJycpIDogcmF3LnRyaW0oKTtcblxuICAgIGlmIChoZWFkZXJMaW5lID09PSBFTkRfUEFUQ0hfTUFSS0VSKSB7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKEFERF9GSUxFX01BUktFUikpIHtcbiAgICAgIGh1bmtzLnB1c2goeyBraW5kOiAnYWRkJywgcGF0aDogaGVhZGVyTGluZS5zbGljZShBRERfRklMRV9NQVJLRVIubGVuZ3RoKSB9KTtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoREVMRVRFX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKERFTEVURV9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChVUERBVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBjb25zdCBodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9ID0ge1xuICAgICAgICBraW5kOiAndXBkYXRlJyxcbiAgICAgICAgcGF0aDogaGVhZGVyTGluZS5zbGljZShVUERBVEVfRklMRV9NQVJLRVIubGVuZ3RoKSxcbiAgICAgICAgbW92ZVBhdGg6IG51bGwsXG4gICAgICAgIGNodW5rczogW11cbiAgICAgIH07XG4gICAgICBodW5rcy5wdXNoKGh1bmspO1xuICAgICAgb3BlblVwZGF0ZSA9IGh1bms7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAob3BlblVwZGF0ZSkge1xuICAgICAgcHJvY2Vzc1VwZGF0ZUxpbmUob3BlblVwZGF0ZSwgcmF3KTtcbiAgICB9XG4gICAgLy8gQW55IG90aGVyIGxpbmUgb3V0c2lkZSBhbiBVcGRhdGUgaHVuayAoQmVnaW4gUGF0Y2gsIEVudmlyb25tZW50IElELCBBZGRcbiAgICAvLyBGaWxlIGArYCBjb250ZW50LCBzdHJheSB0ZXh0KSBpcyBpZ25vcmVkLlxuICB9XG5cbiAgcmV0dXJuIGh1bmtzO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVDaHVuayhodW5rOiBIdW5rICYgeyBraW5kOiAndXBkYXRlJyB9KTogVXBkYXRlQ2h1bmsge1xuICBjb25zdCBsYXN0ID0gaHVuay5jaHVua3NbaHVuay5jaHVua3MubGVuZ3RoIC0gMV07XG4gIGlmIChsYXN0KSByZXR1cm4gbGFzdDtcbiAgY29uc3QgY2h1bms6IFVwZGF0ZUNodW5rID0geyBjaGFuZ2VDb250ZXh0OiBudWxsLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9O1xuICBodW5rLmNodW5rcy5wdXNoKGNodW5rKTtcbiAgcmV0dXJuIGNodW5rO1xufVxuXG4vKiogQXBwbHkgb25lIGJvZHkgbGluZSBvZiBhbiBVcGRhdGUgaHVuayB0byBpdHMgY2h1bmsgbGlzdC4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NVcGRhdGVMaW5lKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0sIHJhdzogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IHRyaW1tZWRFbmQgPSByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJyk7XG5cbiAgaWYgKHRyaW1tZWRFbmQgPT09IEVPRl9NQVJLRVIpIHJldHVybjsgLy8gZW5kLW9mLWZpbGUgaGludDsgbm90IG5lZWRlZCBmb3IgcmFuZ2VzXG5cbiAgLy8gYCoqKiBNb3ZlIHRvOmAgaXMgb25seSBtZWFuaW5nZnVsIGJlZm9yZSBhbnkgY2hhbmdlIGNvbnRlbnQuXG4gIGlmIChodW5rLmNodW5rcy5sZW5ndGggPT09IDAgJiYgaHVuay5tb3ZlUGF0aCA9PT0gbnVsbCAmJiB0cmltbWVkRW5kLnN0YXJ0c1dpdGgoTU9WRV9UT19NQVJLRVIpKSB7XG4gICAgaHVuay5tb3ZlUGF0aCA9IHRyaW1tZWRFbmQuc2xpY2UoTU9WRV9UT19NQVJLRVIubGVuZ3RoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU1QVFlfQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSB7XG4gICAgaHVuay5jaHVua3MucHVzaCh7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAodHJpbW1lZEVuZC5zdGFydHNXaXRoKENIQU5HRV9DT05URVhUX01BUktFUikpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogdHJpbW1lZEVuZC5zbGljZShDSEFOR0VfQ09OVEVYVF9NQVJLRVIubGVuZ3RoKSwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQSBiYXJlIGVtcHR5IGxpbmUgaXMgYW4gZW1wdHkgY29udGV4dCBsaW5lIChwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcpLlxuICBpZiAocmF3ID09PSAnJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY2h1bmsub2xkTGluZXMucHVzaCgnJyk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaCgnJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGZpcnN0ID0gcmF3WzBdO1xuICBpZiAoZmlyc3QgPT09ICcgJykge1xuICAgIGNvbnN0IGNodW5rID0gZW5zdXJlQ2h1bmsoaHVuayk7XG4gICAgY29uc3QgY29udGVudCA9IHJhdy5zbGljZSgxKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKGNvbnRlbnQpO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2goY29udGVudCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJysnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChmaXJzdCA9PT0gJy0nKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKHJhdy5zbGljZSgxKSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFVucmVjb2duaXplZCBjb250ZW50IGxpbmUgXHUyMDE0IGlnbm9yZSBsZW5pZW50bHkgcmF0aGVyIHRoYW4gdGhyb3cuXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3BsaXQgZmlsZSBjb250ZW50IGludG8gbGluZXMgZm9yIG1hdGNoaW5nLiBBIHRyYWlsaW5nIG5ld2xpbmUgeWllbGRzIGFcbiAqIHRyYWlsaW5nIGVtcHR5IGVsZW1lbnQsIHdoaWNoIGlzIGhhcm1sZXNzIGZvciBzdWItc2xpY2UgbWF0Y2hpbmcuICovXG5mdW5jdGlvbiBzcGxpdExpbmVzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGNvbnRlbnQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKiogSW5kaWNlcyAoMC1iYXNlZCkgYXQgd2hpY2ggYHZhbHVlYCBhcHBlYXJzIGFzIGEgZnVsbCBsaW5lIGluIGBsaW5lc2AuICovXG5mdW5jdGlvbiBsaW5lSW5kaWNlcyhsaW5lczogc3RyaW5nW10sIHZhbHVlOiBzdHJpbmcpOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGlmIChsaW5lc1tpXSA9PT0gdmFsdWUpIG91dC5wdXNoKGkpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBTdGFydCBpbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgbmVlZGxlYCBtYXRjaGVzIGNvbnRpZ3VvdXNseSBpbiBgaGF5c3RhY2tgLiAqL1xuZnVuY3Rpb24gY29udGlndW91c01hdGNoZXMoaGF5c3RhY2s6IHN0cmluZ1tdLCBuZWVkbGU6IHN0cmluZ1tdKTogbnVtYmVyW10ge1xuICBjb25zdCBvdXQ6IG51bWJlcltdID0gW107XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwIHx8IG5lZWRsZS5sZW5ndGggPiBoYXlzdGFjay5sZW5ndGgpIHJldHVybiBvdXQ7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBMb2NhdGUgYSBzaW5nbGUgY2h1bmsncyBwcmUtZWRpdCBibG9jayBpbiB0aGUgZmlsZSwgcmV0dXJuaW5nIGl0cyAxLWJhc2VkXG4gKiBsaW5lIHJhbmdlIG9yIG51bGwgd2hlbiBpdCBjYW5ub3QgYmUgbG9jYXRlZCB1bmFtYmlndW91c2x5LlxuICpcbiAqIC0gTm9uLWVtcHR5IGJsb2NrOiByZXF1aXJlIGEgdW5pcXVlIGNvbnRpZ3VvdXMgbWF0Y2gsIG9yIFx1MjAxNCB3aGVuIGR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIGEgYEBAYCBjaGFuZ2UtY29udGV4dCBsaW5lIHRoYXQgc2VsZWN0cyB0aGUgb2NjdXJyZW5jZSBhZnRlciBpdC5cbiAqIC0gRW1wdHkgYmxvY2sgKHB1cmUgaW5zZXJ0aW9uKTogYW5jaG9yIG9uIGEgdW5pcXVlIGNoYW5nZS1jb250ZXh0IGxpbmUgaWYgb25lXG4gKiAgIGlzIGdpdmVuOyBvdGhlcndpc2UgaXQgaXMgdW5sb2NhdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGxvY2F0ZUNodW5rKHByZUxpbmVzOiBzdHJpbmdbXSwgY2h1bms6IFVwZGF0ZUNodW5rKTogTGluZVJhbmdlIHwgbnVsbCB7XG4gIGNvbnN0IGJsb2NrID0gY2h1bmsub2xkTGluZXM7XG5cbiAgaWYgKGJsb2NrLmxlbmd0aCA9PT0gMCkge1xuICAgIGNvbnN0IGN0eCA9IGNodW5rLmNoYW5nZUNvbnRleHQ7XG4gICAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgICBjb25zdCBjdHhJZHhzID0gbGluZUluZGljZXMocHJlTGluZXMsIGN0eCk7XG4gICAgICBpZiAoY3R4SWR4cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgbGluZSA9IGN0eElkeHNbMF0gKyAxO1xuICAgICAgICByZXR1cm4geyBzdGFydDogbGluZSwgZW5kOiBsaW5lIH07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgc3RhcnRzID0gY29udGlndW91c01hdGNoZXMocHJlTGluZXMsIGJsb2NrKTtcbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBzID0gc3RhcnRzWzBdO1xuICAgIHJldHVybiB7IHN0YXJ0OiBzICsgMSwgZW5kOiBzICsgYmxvY2subGVuZ3RoIH07XG4gIH1cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIER1cGxpY2F0ZWQgYmxvY2s6IHVzZSB0aGUgY2hhbmdlIGNvbnRleHQgdG8gc2VsZWN0IHRoZSBtYXRjaCBhZnRlciBpdC5cbiAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgaWYgKGN0eCAhPT0gbnVsbCAmJiBjdHggIT09ICcnKSB7XG4gICAgZm9yIChjb25zdCBjIG9mIGxpbmVJbmRpY2VzKHByZUxpbmVzLCBjdHgpKSB7XG4gICAgICBjb25zdCBhZnRlciA9IHN0YXJ0cy5maW5kKChzKSA9PiBzID49IGMpO1xuICAgICAgaWYgKGFmdGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhcnQ6IGFmdGVyICsgMSwgZW5kOiBhZnRlciArIGJsb2NrLmxlbmd0aCB9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDsgLy8gYW1iaWd1b3VzIFx1MjE5MiBjYWxsZXIgZGVncmFkZXMgdG8gd2hvbGUtZmlsZVxufVxuXG4vKipcbiAqIFJlY292ZXIgYSBzaW5nbGUgbGluZSByYW5nZSBzcGFubmluZyBhbGwgb2YgYW4gdXBkYXRlJ3MgY2h1bmtzLiBSZXR1cm5zIG51bGxcbiAqIChcdTIxOTIgd2hvbGUtZmlsZSBmYWxsYmFjaykgaWYgYW55IGNodW5rIGNhbm5vdCBiZSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2UocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVua3M6IFVwZGF0ZUNodW5rW10pOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgbGV0IHVuaW9uOiBMaW5lUmFuZ2UgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MpIHtcbiAgICBjb25zdCByID0gbG9jYXRlQ2h1bmsocHJlTGluZXMsIGNodW5rKTtcbiAgICBpZiAociA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgdW5pb24gPSB1bmlvbiA9PT0gbnVsbCA/IHIgOiB7IHN0YXJ0OiBNYXRoLm1pbih1bmlvbi5zdGFydCwgci5zdGFydCksIGVuZDogTWF0aC5tYXgodW5pb24uZW5kLCByLmVuZCkgfTtcbiAgfVxuICByZXR1cm4gdW5pb247XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIEFQSVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUGFyc2UgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGNvbW1hbmQgc3RyaW5nIGludG8gYW4gYW5jaG9yIHBlciB0b3VjaGVkIGZpbGUuXG4gKlxuICogLSBgKioqIEFkZCBGaWxlOmAgXHUyMTkyIGBjcmVhdGVgICh3aG9sZS1maWxlKVxuICogLSBgKioqIERlbGV0ZSBGaWxlOmAgXHUyMTkyIGB3aG9sZS13cml0ZWAgd2l0aCB0aGUgYGFic2VudGAgbWFya2VyICh3aG9sZS1maWxlO1xuICogICB0aGUgZmlsZSBubyBsb25nZXIgZXhpc3RzIFx1MjAxNCB0aGUgdG91Y2ggdGFyZ2V0cyBhYnNlbmNlLCBwbGFuIFx1MDBBNzMpXG4gKiAtIGAqKiogVXBkYXRlIEZpbGU6YCBcdTIxOTIgYHdyaXRlYCB3aXRoIGEgcmVjb3ZlcmVkIGxpbmUgcmFuZ2Ugd2hlbiB0aGUgaHVuaydzXG4gKiAgIHByZS1lZGl0IGJsb2NrIGNhbiBiZSBsb2NhdGVkIHZpYSBgcmVhZFByZUVkaXRGaWxlYCwgb3RoZXJ3aXNlIGB3aG9sZS13cml0ZWAuXG4gKiAgIEEgcmVuYW1lZCB1cGRhdGUgKGAqKiogTW92ZSB0bzpgKSBhbmNob3JzIHRoZSBkZXN0aW5hdGlvbiBwYXRoIGFzXG4gKiAgIGB3aG9sZS13cml0ZWAgc2luY2UgcHJlLWVkaXQgbGluZSBudW1iZXJzIGNhbm5vdCBiZSBtYXBwZWQgYWNyb3NzIGEgcmVuYW1lLlxuICpcbiAqIE5ldmVyIHRocm93czogYSBtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggeWllbGRzIGBbXWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUFwcGx5UGF0Y2goXG4gIGNvbW1hbmQ6IHN0cmluZyxcbiAgcmVhZFByZUVkaXRGaWxlOiBSZWFkUHJlRWRpdEZpbGUgPSBkZWZhdWx0UmVhZFByZUVkaXRGaWxlXG4pOiBBcHBseVBhdGNoQW5jaG9yW10ge1xuICBjb25zdCBhbmNob3JzOiBBcHBseVBhdGNoQW5jaG9yW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGh1bmsgb2Ygc2Nhbkh1bmtzKGNvbW1hbmQpKSB7XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2FkZCcpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ2NyZWF0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGh1bmsua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRvUG9zaXgoaHVuay5wYXRoKSwga2luZDogJ3dob2xlLXdyaXRlJywgYWJzZW50OiB0cnVlIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgIi8qKlxuICogQ29kZXggUG9zdFRvb2xVc2UgdG91Y2ggaG9vayBcdTIwMTQgaGVhbCArIHN1cmZhY2UgYWZ0ZXIgYSBjb25maXJtZWQgYGFwcGx5X3BhdGNoYCxcbiAqIG9yIGEgc2hlbGwvZXhlYyBjYWxsIHdob3NlIGNvbW1hbmQgc3RhdGljYWxseSByZXNvbHZlcyB0byBmaWxlK2xpbmUgaWRpb21zLlxuICpcbiAqIFBvc3RUb29sVXNlIGZpcmVzIGFmdGVyIGBhcHBseV9wYXRjaGAgaGFzIHJ1biwgc28gdGhpcyBpcyB0aGUgYWNjdXJhdGUgaG9tZSBmb3JcbiAqIHRoZSB0b3VjaCBzaWduYWw6IHRoZSBmaWxlIGlzIGFscmVhZHkgd3JpdHRlbiwgc28gYSBzY29wZWQgYGdpdCBzcGFuIGRyaWZ0XG4gKiA8ZmlsZT4gLS1maXhgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgYWdhaW5zdCByZWFsIGJ5dGVzIGFuZCB0aGUgc3VyZmFjZWQgYmxvY2tcbiAqIHJlZmxlY3RzIHRoZSBoZWFsZWQgYW5jaG9ycy4gVGhlIGhhbmRsZXIgbmFycm93cyB0aGUgYGFwcGx5X3BhdGNoYCBlbnZlbG9wZVxuICogKGB0b29sX2lucHV0LmNvbW1hbmRgLCBTREstdHlwZWQgYHVua25vd25gKSBpbnRvIHBlci1maWxlIGFuY2hvcnMgdmlhIHRoZVxuICogc2hhcmVkIFthcHBseS1wYXRjaCBwYXJzZXJdKC4vYXBwbHktcGF0Y2gudHMpLCBhbmQgcmVjb3ZlcnMgc2hlbGwgY29tbWFuZHNcbiAqIGZyb20gZWl0aGVyIENvZGV4IGVudmVsb3BlIChjbGFzc2ljIGBleGVjX2NvbW1hbmRgIEpTT04gYGFyZ3VtZW50c2AsIG9yXG4gKiBjb2RlLW1vZGUgYGV4ZWNgIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCkgdmlhIHRoZSBzaGFyZWRcbiAqIFtjb21tYW5kIHBhcnNlcl0oLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQudHMpOyBlYWNoIHRvdWNoZWQgZmlsZSBpcyBzY29wZWQgdG9cbiAqIHRoZSBDV0QgcmVwbywgYW5kIGRyaXZlcyB0aGUgaGFybmVzcy1hZ25vc3RpYyB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlIFx1MjAxNCB0aGVcbiAqIHNhbWUgY29yZSB0aGUgQ2xhdWRlIGFkYXB0ZXIgdXNlcy5cbiAqXG4gKiBUd28gQ29kZXgtc3BlY2lmaWMgY29uY2VybnMgYXJlIHByZXNlcnZlZCBmcm9tIHRoaXMgZmlsZSdzIGpvdXJuYWxpbmdcbiAqIHByZWRlY2Vzc29yOlxuICpcbiAqIDEuICoqU3VjY2VzcyBjbGFzc2lmaWNhdGlvbi4qKiBUaGUgcGFyc2VkIGVudmVsb3BlIGRlc2NyaWJlcyAqaW50ZW50Kiwgbm90XG4gKiAgICAqb3V0Y29tZSouIENvZGV4IGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiB0b29sIHN1Y2Nlc3MsIGJ1dCBhcyBhXG4gKiAgICBkdXJhYmlsaXR5IGJlbHQgd2UgY2xhc3NpZnkgYHRvb2xfcmVzcG9uc2VgIHZpYVxuICogICAge0BsaW5rIGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlfTogYSBjb25maXJtZWQgcmVqZWN0aW9uIChgJ2ZhaWx1cmUnYClcbiAqICAgIHN1cHByZXNzZXMgdGhlIHRvdWNoIChubyBwaGFudG9tIGhlYWwvc3VyZmFjZSBvbiBhIHBhdGNoIHRoYXQgbmV2ZXJcbiAqICAgIGFwcGxpZWQpOyBhIHN1Y2Nlc3Mgb3IgYW4gdW5yZWNvZ25pemVkIHNoYXBlIChgJ3Vua25vd24nYCwgd2FybmVkKSBwcm9jZWVkcy5cbiAqIDIuICoqTm8gcG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5IGZyb20gdGhlIGVudmVsb3BlLioqIFBvc3RUb29sVXNlIHJ1bnMgYWZ0ZXJcbiAqICAgIHRoZSBwYXRjaCByZXdyb3RlIHRoZSBmaWxlLCBzbyB0aGUgaHVuaydzIHByZS1lZGl0IGJsb2NrIG5vIGxvbmdlciBzaXRzXG4gKiAgICB3aGVyZSB0aGUgZWRpdCBoYXBwZW5lZCBhbmQgY291bGQgbWlzLWFuY2hvciBhIGR1cGxpY2F0ZS4gVGhlIHRvdWNoIGlzXG4gKiAgICBzY29wZWQgZmlsZS13aWRlIChgd3JpdHRlbjogJydgIFx1MjE5MiB3aG9sZS1maWxlKSwgd2hpY2ggaXMgZXhhY3RseSB0aGVcbiAqICAgIGJlaGF2aW9yIHtAbGluayBydW5Ub3VjaEhvb2t9IHRha2VzIGZvciBhbiBlbXB0eSB3cml0ZS5cbiAqXG4gKiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaW4gdGhlIGhhbmRsZXIgY29uZmlnICh0aGUgQ0xJIGVtaXRzIGAxMGAgc2Vjb25kcylcbiAqIFx1MjAxNCBzZWUgdGhlIHRpbWVvdXQtdW5pdHMgc3Bpa2Ugbm90ZTsgdGhlIHNvdXJjZSB2YWx1ZSBtdXN0IHN0YXkgaW4gbXMgc28gdGhlXG4gKiBDb2RleCBidWlsZCdzIHNlY29uZHMgY29udmVyc2lvbiBhdCBlbWl0IHJlbWFpbnMgY29ycmVjdC5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFBvc3RUb29sVXNlSW5wdXQsIHBvc3RUb29sVXNlSG9vaywgcG9zdFRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHsgYWJzcGF0aEFnYWluc3QgfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGJhc2hSZXNwb25zZUludGVycnVwdGVkLCBydW5CYXNoVG91Y2hlcyB9IGZyb20gJy4uL2NvbW1vbi9iYXNoLXRvdWNoLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycywgcnVuVG91Y2hIb29rLCB0eXBlIFRvdWNoRXhlY3V0b3JzIH0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuaW1wb3J0IHsgcGFyc2VBcHBseVBhdGNoIH0gZnJvbSAnLi9hcHBseS1wYXRjaC5qcyc7XG5cbi8qKlxuICogVGhlIHByZWZpeCBhcHBseV9wYXRjaCdzIHN0ZG91dCBjYXJyaWVzIHdoZW4gXHUyMDE0IGFuZCBvbmx5IHdoZW4gXHUyMDE0IHRoZSBwYXRjaFxuICogYXBwbGllZCAoY29kZXgtcnMvYXBwbHktcGF0Y2ggYHByaW50X3N1bW1hcnlgKS4gQ29kZXggc3VyZmFjZXMgdGhhdCBzdGRvdXRcbiAqIHZlcmJhdGltIGFzIHRoZSBQb3N0VG9vbFVzZSBgdG9vbF9yZXNwb25zZWAgKGEgYmFyZSBzdHJpbmcgdG9kYXkpLiBGaXhlZFxuICogYWNyb3NzIEFkZC9Nb2RpZnkvRGVsZXRlOyB0aGUgaGVhZGVyIGlzIGZvbGxvd2VkIGJ5IGBBL00vRCA8cGF0aD5gIGxpbmVzLlxuICovXG5jb25zdCBBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCA9ICdTdWNjZXNzLiBVcGRhdGVkIHRoZSBmb2xsb3dpbmcgZmlsZXM6JztcblxuLyoqXG4gKiBUaGUgY29tbW9uIGZpZWxkcyBhbiBvYmplY3Qtd3JhcHBlZCB0b29sX3Jlc3BvbnNlIG1pZ2h0IGNhcnJ5IHRoZSB0b29sJ3MgdGV4dFxuICogb3V0cHV0IHVuZGVyLCBpZiBDb2RleCBldmVyIHN0b3BzIHN1cmZhY2luZyBpdCBhcyBhIGJhcmUgc3RyaW5nLiBPcmRlcmVkIGJ5XG4gKiBsaWtlbGlob29kOyB0aGUgZmlyc3QgZmllbGQgd2hvc2UgdmFsdWUgaXMgYSBzdHJpbmcgd2lucy5cbiAqL1xuY29uc3QgUkVTUE9OU0VfVEVYVF9GSUVMRFMgPSBbJ291dHB1dCcsICdzdGRvdXQnLCAnY29udGVudCcsICd0ZXh0J10gYXMgY29uc3Q7XG5cbi8qKiBOYXJyb3cgdGhlIFNESydzIGB1bmtub3duYCB0b29sX2lucHV0IHRvIHRoZSBgYXBwbHlfcGF0Y2hgIGB7IGNvbW1hbmQgfWAgc2hhcGUuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93QXBwbHlQYXRjaENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICAgIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY2xhc3NpYyBgZXhlY19jb21tYW5kYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY0IDAuMTMwLjApOlxuICogYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gKnN0cmluZyogb2Ygc2hhcGVcbiAqIGB7XCJjbWRcIjogXCIuLi5cIiwgXCJ3b3JrZGlyXCI6IFwiLi4uXCJ9YCBcdTIwMTQgcGFyc2UgaXQgYW5kIHJldHVybiB0aGUgYGNtZGAuIFJldHVybnNcbiAqIGBudWxsYCBmb3IgYW55IG90aGVyIHNoYXBlIChub3QgSlNPTiwgbm8gYGNtZGAgZmllbGQsIG9yIG5vdCB0aGlzIGVudmVsb3BlKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0V4ZWNDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdhcmd1bWVudHMnIGluIHRvb2xJbnB1dCkge1xuICAgIGNvbnN0IGFyZ3MgPSAodG9vbElucHV0IGFzIHsgYXJndW1lbnRzOiB1bmtub3duIH0pLmFyZ3VtZW50cztcbiAgICBpZiAodHlwZW9mIGFyZ3MgPT09ICdzdHJpbmcnKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGFyZ3MpO1xuICAgICAgICBpZiAocGFyc2VkICE9PSBudWxsICYmIHR5cGVvZiBwYXJzZWQgPT09ICdvYmplY3QnICYmIHR5cGVvZiBwYXJzZWQuY21kID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBwYXJzZWQuY21kO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgbmFycm93aW5nIHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlLiBgbWF0Y2hlZGAgc2VwYXJhdGVzXG4gKiBcInRoZSBlbnZlbG9wZSB3YXMgYSBgdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KWAgY2FsbCB3aG9zZSBhcmd1bWVudCBjb3VsZCBub3RcbiAqIGJlIHJlY292ZXJlZFwiIChhIHZhcmlhYmxlL3RlbXBsYXRlLWJ1aWx0IGNvbW1hbmQgXHUyMDE0IHN0YXRpY2FsbHkgdW5yZXNvbHZhYmxlKVxuICogZnJvbSBcInRoZSBlbnZlbG9wZSBpcyBub3QgY29kZS1tb2RlIGV4ZWMgYXQgYWxsXCIsIHNvIHRoZSBoYW5kbGVyIGNhbiB3YXJuIG9uXG4gKiB0aGUgZm9ybWVyIGluc3RlYWQgb2Ygc2lsZW50bHkgY29uZmxhdGluZyBpdCB3aXRoIHRoZSBsYXR0ZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZU1vZGVFeGVjTmFycm93IHtcbiAgLyoqIFdoZXRoZXIgYHRvb2xfaW5wdXQuaW5wdXRgIGNvbnRhaW5lZCBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsLiAqL1xuICBtYXRjaGVkOiBib29sZWFuO1xuICAvKiogVGhlIHJlY292ZXJlZCBgY21kYCBzdHJpbmcsIG9yIGBudWxsYCB3aGVuIG1hdGNoZWQgYnV0IHVucGFyc2FibGUgLyBhYnNlbnQuICovXG4gIGNtZDogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBRdW90ZSBiYXJlIGlkZW50aWZpZXIga2V5cyBpbiBhIEpTIG9iamVjdCBsaXRlcmFsIHNvIGBKU09OLnBhcnNlYCBjYW4gcmVhZFxuICogaXQuIFJlYWwgY29kZS1tb2RlIGNhbGwgc2l0ZXMgZW1pdCBKUy1zdHlsZSB1bnF1b3RlZCBrZXlzXG4gKiAoYHtjbWQ6XCJzZWQgLW4gJzEsMjQwcCcgL3BhdGhcIiwuLi59YCksIHdoaWNoIGlzIHZhbGlkIEpTIGJ1dCBpbnZhbGlkIEpTT04uXG4gKiBTdHJpbmcgdmFsdWVzIChzaW5nbGUtIG9yIGRvdWJsZS1xdW90ZWQpIGFyZSBjb3BpZWQgdmVyYmF0aW0gXHUyMDE0IGluY2x1ZGluZyBhbnlcbiAqIGAsIGtleTpgLXNoYXBlZCB0ZXh0IGluc2lkZSB0aGVtIFx1MjAxNCBhbmQgYWxyZWFkeS1xdW90ZWQga2V5cyBwYXNzIHRocm91Z2hcbiAqIHVudG91Y2hlZC5cbiAqL1xuZnVuY3Rpb24gcXVvdGVPYmplY3RLZXlzKGxpdGVyYWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gbGl0ZXJhbC5sZW5ndGg7XG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBsaXRlcmFsW2ldO1xuICAgIGlmIChjID09PSAnXCInIHx8IGMgPT09IFwiJ1wiKSB7XG4gICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICBjb25zdCBzdGFydCA9IGk7XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IG4pIHtcbiAgICAgICAgaWYgKGxpdGVyYWxbaV0gPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIGkgKz0gMjtcbiAgICAgICAgZWxzZSBpZiAobGl0ZXJhbFtpXSA9PT0gcXVvdGUpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH0gZWxzZSBpICs9IDE7XG4gICAgICB9XG4gICAgICBvdXQgKz0gbGl0ZXJhbC5zbGljZShzdGFydCwgaSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3Qga2V5ID0gbGl0ZXJhbC5zbGljZShpKS5tYXRjaCgvXihcXHt8LClcXHMqKFtBLVphLXpfJF1bQS1aYS16MC05XyRdKilcXHMqOi8pO1xuICAgIGlmIChrZXkpIHtcbiAgICAgIG91dCArPSBgJHtrZXlbMV19XCIke2tleVsyXX1cIjpgO1xuICAgICAgaSArPSBrZXlbMF0ubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG91dCArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIE5hcnJvdyB0aGUgY29kZS1tb2RlIGBleGVjYCBlbnZlbG9wZSAoY2xpX3ZlcnNpb24gXHUyMjY1IDAuMTQ0LjApOlxuICogYHRvb2xfaW5wdXQuaW5wdXRgIGlzIEpTIHNvdXJjZSB0aGF0IGNhbGxzIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBcdTIwMTRcbiAqIHJlY292ZXIgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50IHZpYSBiYWxhbmNlZC1icmFjZSBtYXRjaGluZywgcXVvdGUgaXRzXG4gKiB1bnF1b3RlZCBKUyBrZXlzLCBhbmQgcGFyc2UgaXQuIEEgY29tbWFuZCBidWlsdCBmcm9tIHZhcmlhYmxlcyBvciB0ZW1wbGF0ZVxuICogbGl0ZXJhbHMgaXMgc3RhdGljYWxseSB1bnJlc29sdmFibGU6IHRoZSBjYWxsIHN0aWxsICptYXRjaGVkKiBidXQgeWllbGRzXG4gKiBgY21kOiBudWxsYCwgcmVwb3J0ZWQgZGlzdGluY3RseSBmcm9tIGEgbm9uLWNvZGUtbW9kZSBlbnZlbG9wZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5hcnJvd0NvZGVNb2RlRXhlYyh0b29sSW5wdXQ6IHVua25vd24pOiBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICBpZiAodG9vbElucHV0ICE9PSBudWxsICYmIHR5cGVvZiB0b29sSW5wdXQgPT09ICdvYmplY3QnICYmICdpbnB1dCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgaW5wdXQgPSAodG9vbElucHV0IGFzIHsgaW5wdXQ6IHVua25vd24gfSkuaW5wdXQ7XG4gICAgaWYgKHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIE1hdGNoIHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSkgXHUyMDE0IGV4dHJhY3QgdGhlIGxpdGVyYWwgb2JqZWN0IGFyZ3VtZW50XG4gICAgICBjb25zdCBtYXRjaCA9IGlucHV0Lm1hdGNoKC90b29sc1xcLmV4ZWNfY29tbWFuZFxcKFxccyooXFx7KD86W157fV18XFx7KD86W157fV18XFx7W157fV0qXFx9KSpcXH0pKlxcfSlcXHMqXFwpLyk7XG4gICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHF1b3RlT2JqZWN0S2V5cyhtYXRjaFsxXSkpO1xuICAgICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IHBhcnNlZC5jbWQgfTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIG1hdGNoZWQsIGJ1dCB0aGUgbGl0ZXJhbCBkaWQgbm90IHBhcnNlIFx1MjAxNCB0aGUgY2FsbCBpcyBzdGlsbCBhXG4gICAgICAgICAgLy8gY29kZS1tb2RlIGV4ZWMgd2hvc2UgY29tbWFuZCBjYW5ub3QgYmUgcmVjb3ZlcmVkIHN0YXRpY2FsbHkuXG4gICAgICAgICAgcmV0dXJuIHsgbWF0Y2hlZDogdHJ1ZSwgY21kOiBudWxsIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgbWF0Y2hlZDogZmFsc2UsIGNtZDogbnVsbCB9O1xufVxuXG4vKipcbiAqIFRvbGVyYW50bHkgcHVsbCB0aGUgdG9vbCdzIHRleHR1YWwgb3V0cHV0IG91dCBvZiBhIGB0b29sX3Jlc3BvbnNlYCBvZlxuICogdW5jZXJ0YWluIHNoYXBlIChTREstdHlwZWQgYHVua25vd25gKTogYSBiYXJlIHN0cmluZyAodG9kYXkncyBDb2RleCkgaXNcbiAqIHJldHVybmVkIGFzLWlzOyBhbiBvYmplY3QgaXMgcHJvYmVkIGZvciB0aGUgZmlyc3Qge0BsaW5rIFJFU1BPTlNFX1RFWFRfRklFTERTfVxuICogZW50cnkgdGhhdCBob2xkcyBhIHN0cmluZy4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyB0ZXh0IGNhbiBiZSByZWNvdmVyZWRcbiAqICh1bmtub3duIG9iamVjdCBzaGFwZSwgYG51bGxgLCBvciBhIG5vbi1zdHJpbmcvbm9uLW9iamVjdCksIHdoaWNoIHRoZSBjYWxsZXJcbiAqIHRyZWF0cyBhcyBhbiAqdW5yZWNvZ25pemVkKiBcdTIwMTQgbm90ICpmYWlsZWQqIFx1MjAxNCByZXNwb25zZS5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdzdHJpbmcnKSByZXR1cm4gdG9vbFJlc3BvbnNlO1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgcmVjb3JkID0gdG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGZvciAoY29uc3QgZmllbGQgb2YgUkVTUE9OU0VfVEVYVF9GSUVMRFMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2ZpZWxkXTtcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENsYXNzaWZ5IGFuIGBhcHBseV9wYXRjaGAgYHRvb2xfcmVzcG9uc2VgIGZvciB0aGUgdG91Y2ggZ2F0ZTpcbiAqXG4gKiAtIGAnc3VjY2VzcydgIFx1MjAxNCB0ZXh0IHdhcyByZWNvdmVyZWQgYW5kIGNhcnJpZXMge0BsaW5rIEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYfS5cbiAqIC0gYCdmYWlsdXJlJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBidXQgbGFja3MgdGhlIGhlYWRlcjogYSBnZW51aW5lIHJlamVjdGlvblxuICogICBvciBlcnJvci4gVGhlIE9OTFkgY2xhc3NpZmljYXRpb24gdGhhdCBzdXBwcmVzc2VzIHRoZSB0b3VjaC5cbiAqIC0gYCd1bmtub3duJ2AgXHUyMDE0IG5vIHRleHQgY291bGQgYmUgcmVjb3ZlcmVkICh1bnJlY29nbml6ZWQgc2hhcGUpLiBXZSBwcm9jZWVkXG4gKiAgIGRlZmVuc2l2ZWx5IGhlcmUgcmF0aGVyIHRoYW4gcmlzayBtaXNzaW5nIGEgcmVhbCBlZGl0J3MgaGVhbC9zdXJmYWNlOyBDb2RleFxuICogICBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gc3VjY2Vzcywgc28gdGhpcyBjYW5ub3QgaGVhbC9zdXJmYWNlIGEgcGF0Y2hcbiAqICAgdGhhdCBuZXZlciBhcHBsaWVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UodG9vbFJlc3BvbnNlOiB1bmtub3duKTogJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nIHtcbiAgY29uc3QgdGV4dCA9IGV4dHJhY3RSZXNwb25zZVRleHQodG9vbFJlc3BvbnNlKTtcbiAgaWYgKHRleHQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gIHJldHVybiB0ZXh0LnN0YXJ0c1dpdGgoQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVgpID8gJ3N1Y2Nlc3MnIDogJ2ZhaWx1cmUnO1xufVxuXG4vKiogQSByZWFkZXIgdGhhdCBhbHdheXMgZGVjbGluZXMsIGZvcmNpbmcgdGhlIHBhcnNlciB0byB3aG9sZS1maWxlIGFuY2hvcnMuICovXG5jb25zdCBub1JhbmdlUmVjb3ZlcnkgPSAoKTogbnVsbCA9PiBudWxsO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHRvb2xfbmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG5cbiAgICAvLyBTaGVsbCB0b3VjaDogZXh0cmFjdCB0aGUgY29tbWFuZCBmcm9tIHdoaWNoZXZlciBlbnZlbG9wZSBzaGFwZSB0aGUgaGFybmVzc1xuICAgIC8vIGRlbGl2ZXJzLCBwYXJzZSwgYW5kIHJ1biBlYWNoIHJlc29sdmVkIHNwYW4gdGhyb3VnaCB0aGUgc2hhcmVkIHRvdWNoIGNvcmUuXG4gICAgLy9cbiAgICAvLyAtIGBCYXNoYDogdGhlIGhhcm5lc3MtdW53cmFwcGVkIHNoYXBlIENvZGV4IFx1MjI2NTAuMTQ0IGFjdHVhbGx5IHNlbmRzIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuY29tbWFuZGAgaXMgdGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyAoc2FtZSBzaGFwZSB0aGVcbiAgICAvLyAgIENsYXVkZSBhZGFwdGVyIGhhbmRsZXMpLlxuICAgIC8vIC0gYGV4ZWNfY29tbWFuZGA6IGNsYXNzaWMgZnVuY3Rpb25fY2FsbCBlbnZlbG9wZSAoY2xpIFx1MjI2NDAuMTMwKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmFyZ3VtZW50c2AgaXMgYSBKU09OIHN0cmluZyB3aXRoIGEgYGNtZGAgZmllbGQuXG4gICAgLy8gLSBgZXhlY2A6IGRpcmVjdCBjb2RlLW1vZGUgZW52ZWxvcGUgKG1heSBzaGlwIGluIGEgZnV0dXJlIENMSSkgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHdyYXBwaW5nIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYC5cbiAgICAvL1xuICAgIC8vIEEgY29tbWFuZCB3aXRoIG5vIHJlY29nbml6ZWQgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyB1bmRlZmluZWQgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSBhcHBseV9wYXRjaCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJyB8fCB0b29sX25hbWUgPT09ICdleGVjX2NvbW1hbmQnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWMnKSB7XG4gICAgICBsZXQgY29tbWFuZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICBpZiAodG9vbF9uYW1lID09PSAnQmFzaCcpIHtcbiAgICAgICAgLy8gVGhlIGhhcm5lc3MgYWxyZWFkeSB1bndyYXBwZWQgdGhlIGNvZGUtbW9kZSBlbnZlbG9wZSBcdTIwMTQgdGhlIGNvbW1hbmQgaXNcbiAgICAgICAgLy8gaW4gYHRvb2xfaW5wdXQuY29tbWFuZGAsIGV4YWN0bHkgYXMgdGhlIENsYXVkZSBhZGFwdGVyIHJlY2VpdmVzIGl0LlxuICAgICAgICBjb25zdCByYXcgPSAoaW5wdXQudG9vbF9pbnB1dCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpPy5jb21tYW5kO1xuICAgICAgICBjb21tYW5kID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tbWFuZCA9IG5hcnJvd0V4ZWNDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwgJiYgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgICAgLy8gQ29kZS1tb2RlIGBleGVjYCB3cmFwcyB0aGUgc2FtZSBjYWxsIGluIEpTIHNvdXJjZS4gQSBtYXRjaGVkIGNhbGxcbiAgICAgICAgLy8gd2hvc2UgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZCAodmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZClcbiAgICAgICAgLy8gaXMgYSBkaXN0aW5jdCBvdXRjb21lIGZyb20gXCJub3QgYSBjb2RlLW1vZGUgZW52ZWxvcGUgYXQgYWxsXCI6IHdhcm4gc29cbiAgICAgICAgLy8gdGhlIGJsaW5kIHNwb3QgaXMgdmlzaWJsZSBpbnN0ZWFkIG9mIHNpbGVudGx5IGNvbmZsYXRlZCB3aXRoIG5vIG1hdGNoLlxuICAgICAgICBjb25zdCBjb2RlTW9kZSA9IG5hcnJvd0NvZGVNb2RlRXhlYyhpbnB1dC50b29sX2lucHV0KTtcbiAgICAgICAgaWYgKGNvZGVNb2RlLm1hdGNoZWQgJiYgY29kZU1vZGUuY21kID09PSBudWxsKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgJ0NvZGV4IGNvZGUtbW9kZSBleGVjIGVudmVsb3BlIG1hdGNoZWQgYnV0IGl0cyBleGVjX2NvbW1hbmQgYXJndW1lbnQgY291bGQgbm90IGJlIHBhcnNlZDsgbm8gc2hlbGwgdG91Y2gnLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB0b29sSW5wdXRUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9pbnB1dCxcbiAgICAgICAgICAgICAgdG9vbElucHV0S2V5czpcbiAgICAgICAgICAgICAgICBpbnB1dC50b29sX2lucHV0ICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX2lucHV0ID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbW1hbmQgPSBjb2RlTW9kZS5jbWQ7XG4gICAgICB9XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIEFuIGludGVycnVwdGVkIGNvbW1hbmQgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zOyB0aGVcbiAgICAgIC8vIGRyaXZlciByZS1jaGVja3MgZGVmZW5zaXZlbHkuXG4gICAgICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQoaW5wdXQudG9vbF9yZXNwb25zZSkpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IGF3YWl0IHJ1bkJhc2hUb3VjaGVzKG1hdGNoZXMsIHNlc3Npb25JZCwgY3dkLCBpbnB1dC50b29sX3Jlc3BvbnNlLCBleGVjdXRvcnMsIG1lbW8sIChtZXNzYWdlKSA9PlxuICAgICAgICBjdHgubG9nZ2VyLndhcm4obWVzc2FnZSlcbiAgICAgICk7XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kID0gbmFycm93QXBwbHlQYXRjaENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAvLyBTdXBwcmVzcyBvbmx5IGEgKmNvbmZpcm1lZCogbm9uLXN1Y2Nlc3MuIEFuIHVucmVjb2duaXplZCByZXNwb25zZSBzaGFwZVxuICAgIC8vIHByb2NlZWRzICh3aXRoIGEgd2FybmluZykgcmF0aGVyIHRoYW4gcmlzayBza2lwcGluZyBhIHJlYWwgZWRpdCdzIHRvdWNoLlxuICAgIGNvbnN0IGNsYXNzaWZpY2F0aW9uID0gY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2UoaW5wdXQudG9vbF9yZXNwb25zZSk7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAnZmFpbHVyZScpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKGNsYXNzaWZpY2F0aW9uID09PSAndW5rbm93bicpIHtcbiAgICAgIGN0eC5sb2dnZXIud2FybignQ29kZXggYXBwbHlfcGF0Y2ggdG9vbF9yZXNwb25zZSBzaGFwZSB1bnJlY29nbml6ZWQ7IHJ1bm5pbmcgdG91Y2ggZGVmZW5zaXZlbHknLCB7XG4gICAgICAgIHRvb2xSZXNwb25zZVR5cGU6IHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlLFxuICAgICAgICB0b29sUmVzcG9uc2VLZXlzOlxuICAgICAgICAgIGlucHV0LnRvb2xfcmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UgPT09ICdvYmplY3QnXG4gICAgICAgICAgICA/IE9iamVjdC5rZXlzKGlucHV0LnRvb2xfcmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gT25lIGVudmVsb3BlIG1heSB0b3VjaCBzZXZlcmFsIGZpbGVzOyBmb3JjZSB3aG9sZS1maWxlIGFuY2hvcnMgKENvZGV4IG5ldmVyXG4gICAgLy8gcmVjb3ZlcnMgYSBwb3N0LWVkaXQgcmFuZ2UpIGFuZCBydW4gdGhlIHNoYXJlZCB0b3VjaCBjb3JlIHBlciB0b3VjaGVkIGZpbGUuXG4gICAgLy8gVGhlIHNoYXJlZCBtZW1vIGRlZHVwZXMgc3BhbiByZW5kZXJzIGFjcm9zcyBhbmNob3JzIGFuZCB0aGUgc2Vzc2lvbi5cbiAgICBjb25zdCBhbmNob3JzID0gcGFyc2VBcHBseVBhdGNoKGNvbW1hbmQsIG5vUmFuZ2VSZWNvdmVyeSk7XG4gICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICAgIGNvbnN0IGFic1BhdGggPSBhYnNwYXRoQWdhaW5zdChjd2QsIGFuY2hvci5wYXRoKTtcbiAgICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICAgIGlmICghc2NvcGUpIGNvbnRpbnVlO1xuICAgICAgLy8gQSBgKioqIERlbGV0ZSBGaWxlOmAgYW5jaG9yIGNhcnJpZXMgdGhlIGFic2VudCBtYXJrZXIgKHBsYW4gXHUwMEE3Myk6IGl0c1xuICAgICAgLy8gdG91Y2ggdGFyZ2V0cyBhYnNlbmNlIFx1MjAxNCB0aGUgZGVsZXRlIGdhdGUgdmVyaWZpZXMgdGhlIHBhdGggaXMgZ29uZSBBTkRcbiAgICAgIC8vIHdhcyByZWFsIChpbmRleC10cmFja2VkIG9yIHNwYW5uZWQpIGJlZm9yZSBmaXJpbmcuIEV2ZXJ5dGhpbmcgZWxzZVxuICAgICAgLy8gdGFyZ2V0cyBleGlzdGVuY2UuXG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICBjd2QsXG4gICAgICAgICAgZmlsZVBhdGg6IGFic1BhdGgsXG4gICAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgICAgdGFyZ2V0U3RhdGU6IGFuY2hvci5hYnNlbnQgPyAnYWJzZW50JyA6ICdleGlzdHMnLFxuICAgICAgICAgIC4uLihhbmNob3IuYWJzZW50ID8geyBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9IH0gOiB7fSlcbiAgICAgICAgfSxcbiAgICAgICAgZXhlY3V0b3JzLFxuICAgICAgICBtZW1vXG4gICAgICApO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG5cbiAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwb3N0VG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnYXBwbHlfcGF0Y2h8ZXhlY19jb21tYW5kfGV4ZWN8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL3Bvc3QtdG9vbC11c2UudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFJTyxTQUFTLGdCQUFnQixRQUFRLFNBQVM7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L0MsWUFBTSxRQUFRLGtCQUFrQixLQUFLLE9BQU87QUFDNUMsVUFBSSxDQUFDLE1BQU87QUFLWixZQUFNLFNBQVMsTUFBTTtBQUFBLFFBQ25CO0FBQUEsVUFDRSxNQUFNO0FBQUEsVUFDTjtBQUFBLFVBQ0E7QUFBQSxVQUNBLFVBQVU7QUFBQSxVQUNWLFNBQVM7QUFBQSxVQUNULGFBQWEsT0FBTyxTQUFTLFdBQVc7QUFBQSxVQUN4QyxHQUFJLE9BQU8sU0FBUyxFQUFFLFdBQVcsRUFBRSxZQUFZLEtBQUssRUFBRSxJQUFJLENBQUM7QUFBQSxRQUM3RDtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUNBLFVBQUksT0FBTyxrQkFBbUIsUUFBTyxLQUFLLE9BQU8saUJBQWlCO0FBQUEsSUFDcEU7QUFFQSxRQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFDaEMsVUFBTSxXQUFXLE9BQU8sS0FBSyxFQUFFO0FBQy9CLFdBQU8sa0JBQWtCLEVBQUUsbUJBQW1CLFVBQVUsZUFBZSxTQUFTLENBQUM7QUFBQSxFQUNuRjtBQUNGO0FBRUEsSUFBTyx3QkFBUSxnQkFBZ0IsRUFBRSxTQUFTLHNDQUFzQyxTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQzlVbEgsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAibG9nZ2VyIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJiYXNlbmFtZSIsICJqb2luIiwgImV4ZWNGaWxlU3luYyIsICJqb2luIiwgImJhc2VuYW1lIiwgImpvaW4iLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJyZWFkRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiam9pbiIsICJzdGF0U3luYyIsICJiYXNlbmFtZSIsICJyZWFkRmlsZVN5bmMiLCAidG9rZW5zIiwgImZzIiwgInRvUG9zaXgiLCAiY3R4IiwgInJlY292ZXJSYW5nZSIsICJjb21tYW5kIiwgImJsb2NrcyIsICJjb21iaW5lZCJdCn0K
