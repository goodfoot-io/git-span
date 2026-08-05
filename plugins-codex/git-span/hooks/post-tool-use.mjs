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
function joinOfCommand(matches) {
  for (const m of matches) {
    if (m.span.join !== void 0) return m.span.join;
  }
  return void 0;
}
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn) {
  if (bashResponseInterrupted(toolResponse)) return [];
  const resolved = matches.filter((m) => m.status === "resolved");
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
  commandOrder.sort((a, b) => a - b);
  const evals = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const spans = groups.get(idx);
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
    for (const e of evals.get(idx)) {
      if (e.outcome === "decisivePass") {
        const prev = passByPath.get(e.path);
        if (prev === void 0 || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }
  for (const idx of commandOrder) {
    for (const e of evals.get(idx)) {
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
    let failed = false;
    let passed = false;
    for (const e of evals.get(idx)) {
      if (e.outcome === "decisiveFail" && !e.explained) failed = true;
      if (e.outcome === "decisivePass") passed = true;
    }
    computed.set(idx, failed ? "failed" : passed ? "succeeded" : "unknown");
  }
  const effective = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  let prevIndex = null;
  for (const idx of commandOrder) {
    const join5 = joinOfCommand(groups.get(idx));
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
    let touches = 0;
    for (const e of evals.get(idx)) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
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
function parseUnifiedDiffRange(patchText, strip) {
  const results = [];
  let sawBlock = false;
  let current = null;
  let pendingKind = null;
  let renameFrom = null;
  let renameTo = null;
  let binary = false;
  const stripped = (raw) => {
    if (raw === "/dev/null") return raw;
    return stripPathComponents(raw, stripLevelFor(raw, strip));
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
  for (const line of patchText.split("\n")) {
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
      else current.path = path;
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
      return { cmdStart, openerLineEnd, delim, tabStrip };
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
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body });
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
  if (host === void 0 || host === ":") {
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
function stripTransparentWrapper(argv) {
  return argv[0] === "command" || argv[0] === "env" ? argv.slice(1) : argv;
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
  noValue: /* @__PURE__ */ new Set(["-r", "-R", "-p", "-f", "-v", "-n", "-i", "-u", "-a", "-d", "-L", "-P"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(["-b", "--backup"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var INSTALL_SPEC = {
  idiom: "install-write",
  noValue: /* @__PURE__ */ new Set(["-D", "-s", "-v"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory", "-m", "-o", "-g"]),
  excluded: /* @__PURE__ */ new Set(["-d"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-i", "-n", "-v", "-u"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
var GIT_MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-k", "-v"]),
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
    if (spec.noValue.has(a)) {
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
function classifyHeredocOpener(opener, body, currentDir, simpleCommandIndex, join5, results) {
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
            ...singlePlainAppend && r.op === ">>" ? { written: body } : {}
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
            ...singlePlainOverwrite ? { written: `${body}
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
              ...contentRedirects.length === 0 ? { written: body } : {}
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
              ...contentRedirects.length === 0 ? { written: `${body}
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
      if (restAfter.length >= 2) {
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
      classifyHeredocOpener(w.opener, w.body, currentDir, i, joinOf(simple), results);
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
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY29kZXgvYXBwbHktcGF0Y2gudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NvZGV4L3Bvc3QtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHNwYW4tc3VyZmFjaW5nIGNvcmUuXG4gKlxuICogR2l2ZW4gYW4gYWxyZWFkeS1yZXNvbHZlZCByZXBvLXJlbGF0aXZlIHBhdGggYW5kIGEgbGluZSByYW5nZSwgdGhpcyBtb2R1bGVcbiAqIHJ1bnMgdGhlIHNoYXJlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgLyBgLmhvb2tpZ25vcmVgIC8gc2Vzc2lvbi1tZW1vIC9cbiAqIGBnaXQgc3BhbiBkcmlmdGAgcGlwZWxpbmUgYW5kIGFzc2VtYmxlcyB0aGUgaHVtYW4tcmVhZGFibGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmBcbiAqIGJsb2NrIHRoYXQgYm90aCBhZGFwdGVycyBzdXJmYWNlIGlubGluZSBiZWZvcmUgYW4gZWRpdC4gSXQgaW1wb3J0cyBub3RoaW5nXG4gKiBmcm9tIGVpdGhlciBob29rIFNESzogdGhlIENsYXVkZSBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgYSByYW5nZSBkZXJpdmVkIGZyb21cbiAqIGBmaWxlX3BhdGhgL2BvZmZzZXRgL2BvbGRfc3RyaW5nYDsgdGhlIENvZGV4IFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCB0aGVcbiAqIHJhbmdlcyByZWNvdmVyZWQgZnJvbSBhbiBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlLiBFYWNoIGFkYXB0ZXIgd3JhcHMgdGhlXG4gKiByZXR1cm5lZCBibG9jayBzdHJpbmcgaW4gaXRzIG93biBTREsgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogVGhlIGV4ZWN1dG9yL2RyaWZ0L21lbW8gZGVwZW5kZW5jaWVzIGFyZSBpbmplY3RlZCBzbyB0aGUgcGlwZWxpbmUgaXMgdGVzdGFibGVcbiAqIHdpdGggZmFrZXMgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGUgc2hhcmVkIGtlcm5lbC5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgaXNHaXRJZ25vcmVkLFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICBwcnVuZVN0YWxlU2Vzc2lvbnMsXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICBzZXNzaW9uRGlyLFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IHR5cGUgSG9va0lnbm9yZUxvYWRlciwgaXNTcGFuU3VwcHJlc3NlZCB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG4vKipcbiAqIE1pbmltYWwgbG9nZ2VyIHN1cmZhY2UgdGhlIGBjb21tb24vYCBsYXllciBsb2dzIHRocm91Z2g7IGJvdGggU0RLIGxvZ2dlcnNcbiAqIHNhdGlzZnkgaXQuIGB3YXJuYCBpcyByZXF1aXJlZCBcdTIwMTQgZXZlcnkgZXhpc3RpbmcgY2FsbCBzaXRlIHJlcG9ydHMgYSBmYWlsdXJlLlxuICogYGluZm9gIGlzIG9wdGlvbmFsIHNvIGEgZmFrZSBjYXJyeWluZyBvbmx5IGB3YXJuYCBzdGlsbCBzYXRpc2ZpZXMgdGhlXG4gKiBpbnRlcmZhY2U6IGl0IGV4aXN0cyBmb3IgdGhlIGRpYWdub3N0aWMgYnJlYWRjcnVtYnMgYSAqc3VjY2Vzc2Z1bCogcnVuIGxlYXZlc1xuICogYmVoaW5kIChhZHZpc29yLWNvcmUncyBjaHVybi1zdXBwcmVzc2lvbiBjb3VudCksIHdoaWNoIGFyZSBub3Qgd2FybmluZ3MgYW5kXG4gKiBtdXN0IG5vdCByZWFkIGFzIGZhaWx1cmVzIGluIHRoZSBob29rIGxvZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb3JlTG9nZ2VyIHtcbiAgd2FybihtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG4gIGluZm8/KG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTcGFuIGV4ZWN1dG9yIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBFeGVjdXRlcyBgZ2l0IHNwYW4gbGlzdGAgd2l0aCBnaXZlbiBhcmdzIGluIGEgZ2l2ZW4gY3dkLlxuICogUmV0dXJucyBzdGRvdXQgc3RyaW5nLiBUaHJvd3Mgb24gbm9uLXplcm8gZXhpdC5cbiAqL1xuZXhwb3J0IHR5cGUgU3BhbkV4ZWN1dG9yID0gKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFNwYW5FeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBTcGFuRXhlY3V0b3Ige1xuICByZXR1cm4gKGFyZ3MsIGN3ZCkgPT4ge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4uYXJnc10sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5zIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPHNsdWdzPmAgYW5kIHJldHVybnMgaXRzIHBvcmNlbGFpbiBzdGRvdXQgXHUyMDE0XG4gKiBvbmUgcm93IHBlciAqZHJpZnRlZCogYW5jaG9yIGFtb25nIHRoZSBnaXZlbiBzcGFucywgZW1wdHkgd2hlbiBhbGwgYXJlIGNsZWFuLlxuICogYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAwIGluIHBvcmNlbGFpbiBtb2RlIHdoZXRoZXIgb3Igbm90IGRyaWZ0IGV4aXN0cywgYnV0IHdlXG4gKiBzdGlsbCBjYXB0dXJlIHN0ZG91dCBmcm9tIGEgdGhyb3duIGVycm9yIHNvIGEgZHJpZnQgc2lnbmFsIGlzIG5ldmVyIGxvc3QgdG8gYVxuICogbm9uLXplcm8gZXhpdC4gVGhyb3dzIG9ubHkgd2hlbiBubyBzdGRvdXQgaXMgYXZhaWxhYmxlIChnZW51aW5lIGZhaWx1cmUpLlxuICovXG5leHBvcnQgdHlwZSBEcmlmdEV4ZWN1dG9yID0gKHNsdWdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHREcmlmdEV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IERyaWZ0RXhlY3V0b3Ige1xuICByZXR1cm4gKHNsdWdzLCBjd2QpID0+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNsdWdzXSwge1xuICAgICAgICBjd2QsXG4gICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgaWYgKHR5cGVvZiBvdXQgPT09ICdzdHJpbmcnKSByZXR1cm4gb3V0O1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIG1lbW8gYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lbW9TdG9yZSB7XG4gIGdldFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nKTogU2V0PHN0cmluZz47XG4gIGFkZFN1cmZhY2VkKHNlc3Npb25JZDogc3RyaW5nLCBuYW1lczogc3RyaW5nW10pOiB2b2lkO1xufVxuXG4vLyBMaXZlcyB1bmRlciB0aGUgc2hhcmVkIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSAoYWdlbnQtaG9va3MtY29tbW9uLnRzJ3Ncbi8vIHNlc3Npb25EaXIpIFx1MjAxNCByZWxvY2F0ZWQgZnJvbSBvcy50bXBkaXIoKS9hZ2VudC1ob29rcy1naXQtc3Bhbi8gc29cbi8vIHBlci1zZXNzaW9uIHN0YXRlIGhhcyBvbmUgaG9tZSBhbmQgaXMgY292ZXJlZCBieSBwcnVuZVN0YWxlU2Vzc2lvbnMnc1xuLy8gb3Bwb3J0dW5pc3RpYyA+MzAtZGF5IHBydW5pbmcuXG5mdW5jdGlvbiBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihzZXNzaW9uRGlyKHNlc3Npb25JZCksICd0b3VjaC1tZW1vLmpzb24nKTtcbn1cblxuZXhwb3J0IHR5cGUgTWVtb0xvZ2dlciA9IENvcmVMb2dnZXI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJhdyA9IGZzLnJlYWRGaWxlU3luYyhtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKSwgJ3V0ZjgnKTtcbiAgICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIHsgc3VyZmFjZWQ/OiB1bmtub3duIH07XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBhcnNlZC5zdXJmYWNlZCkpIHtcbiAgICAgICAgICByZXR1cm4gbmV3IFNldChwYXJzZWQuc3VyZmFjZWQgYXMgc3RyaW5nW10pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gcmVhZCBmYWlsZWQgKHRyZWF0aW5nIGFzIGVtcHR5KScsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBTZXQoKTtcbiAgICB9LFxuICAgIGFkZFN1cmZhY2VkKHNlc3Npb25JZCwgbmFtZXMpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gICAgICBmb3IgKGNvbnN0IG4gb2YgbmFtZXMpIGV4aXN0aW5nLmFkZChuKTtcbiAgICAgIGNvbnN0IG1lbW9EaXIgPSBzZXNzaW9uRGlyKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCBtZW1vUGF0aCA9IG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgdG1wUGF0aCA9IGAke21lbW9QYXRofS50bXBgO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKG1lbW9EaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHRtcFBhdGgsIEpTT04uc3RyaW5naWZ5KHsgc3VyZmFjZWQ6IFsuLi5leGlzdGluZ10gfSksICd1dGY4Jyk7XG4gICAgICAgIGZzLnJlbmFtZVN5bmModG1wUGF0aCwgbWVtb1BhdGgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHdyaXRlIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqIEZhY3RvcnkgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIGEgTWVtb1N0b3JlIGdpdmVuIGEgbG9nZ2VyLiAqL1xuZXhwb3J0IHR5cGUgTWVtb0ZhY3RvcnkgPSAobG9nZ2VyOiBNZW1vTG9nZ2VyKSA9PiBNZW1vU3RvcmU7XG5cbi8qKiBEZWZhdWx0IGRpc2stYmFja2VkIG1lbW8gZmFjdG9yeSB1c2VkIGluIHByb2R1Y3Rpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZGlza01lbW9GYWN0b3J5KGxvZ2dlcjogTWVtb0xvZ2dlcik6IE1lbW9TdG9yZSB7XG4gIHJldHVybiBjcmVhdGVEaXNrTWVtb1N0b3JlKGxvZ2dlcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggc2NvcGUgcmVzb2x1dGlvbiAocmVwby1zY29waW5nICsgZ2l0aWdub3JlICsgc3Bhbi1yb290IGd1YXJkcylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoU2NvcGUge1xuICByZXBvUm9vdDogc3RyaW5nO1xuICByZXBvUmVsUGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIEJvdW5kIGEgdG91Y2hlZCBmaWxlIHRvIHRoZSBDV0QgcmVwby4gUmVzb2x2ZSB0aGUgcmVwbyByb290IG9mIHRoZSBjdXJyZW50XG4gKiB3b3JraW5nIGRpcmVjdG9yeSBhbmQgcmVxdWlyZSB0aGUgdG91Y2hlZCBmaWxlIHRvIHJlc29sdmUgdG8gdGhlIFNBTUUgcmVwb1xuICogcm9vdDsgZHJvcCBmaWxlcyBpbiBhIGRpZmZlcmVudCByZXBvc2l0b3J5L3dvcmt0cmVlLCBnaXRpZ25vcmVkIGZpbGVzLCBhbmRcbiAqIGZpbGVzIHVuZGVyIHRoZSBzcGFuIHJvb3QuIFJldHVybnMgdGhlIHJlc29sdmVkIGB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9YFxuICogb3IgbnVsbCB3aGVuIHRoZSB0b3VjaCBpcyBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQ29tcGFyaW5nIHJlc29sdmVkIGBnaXQgLS1zaG93LXRvcGxldmVsYCB0b3BsZXZlbHMgKG5vdCBwYXRoIHByZWZpeGVzKVxuICogZGlzdGluZ3Vpc2hlcyBzZXBhcmF0ZSByZXBvcyBhbmQgd29ya3RyZWVzIGFuZCBpcyByb2J1c3QgdG8gc3ltbGlua3MuIEZhaWxcbiAqIGNsb3NlZDogaWYgdGhlIENXRCByZXBvIGNhbid0IGJlIHJlc29sdmVkLCB0aGUgdG91Y2ggaXMgZHJvcHBlZCByYXRoZXIgdGhhblxuICogZmFsbGluZyBiYWNrIHRvIHRoZSBmaWxlJ3Mgb3duIHJlcG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlVG91Y2hTY29wZShjd2Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogVG91Y2hTY29wZSB8IG51bGwge1xuICBjb25zdCBjd2RSZXBvUm9vdCA9IGN3ZCA/IHJlc29sdmVSZXBvUm9vdChjd2QpIDogbnVsbDtcbiAgaWYgKCFjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgYWJzRGlyID0gdG9Qb3NpeChub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKTtcbiAgY29uc3QgZmlsZVJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGFic0Rpcik7XG4gIGlmIChmaWxlUmVwb1Jvb3QgIT09IGN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCByZXBvUm9vdCA9IGN3ZFJlcG9Sb290O1xuICBjb25zdCByZXBvUmVsUGF0aCA9IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhYnNQYXRoKTtcblxuICAvLyBTa2lwIGdpdGlnbm9yZWQgZmlsZXMgZW50aXJlbHkuIEJ1aWxkIG91dHB1dCwgY2FjaGVzLCBhbmQgbG9ncyBhcmUgbm90XG4gIC8vIHNwYW4tcmVsZXZhbnQ6IHRoZXkgbXVzdCBuZXZlciBzdXJmYWNlIHNwYW4gb3ZlcmxhcHMuXG4gIGlmIChpc0dpdElnbm9yZWQocmVwb1Jvb3QsIHJlcG9SZWxQYXRoKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU2tpcCBzcGFuIGRvY3VtZW50cyBlbnRpcmVseS4gRmlsZXMgdW5kZXIgdGhlIHJlc29sdmVkIHNwYW4gcm9vdCBhcmUgbWFuYWdlZFxuICAvLyBieSBnaXQgc3BhbiBpdHNlbGYgYW5kIGFyZSBub3QgYXBwbGljYXRpb24gc291cmNlcyB0aGF0IG5lZWQgc3BhbiBjb3ZlcmFnZS5cbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICBpZiAoaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aCwgc3BhblJvb3QpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTdXJmYWNlIHJvdXRpbmVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogSW5qZWN0ZWQgZGVwZW5kZW5jaWVzIGZvciB7QGxpbmsgc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnN9LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdXJmYWNlRGVwcyB7XG4gIGV4ZWN1dG9yOiBTcGFuRXhlY3V0b3I7XG4gIGRyaWZ0RXhlY3V0b3I6IERyaWZ0RXhlY3V0b3I7XG4gIG1lbW86IE1lbW9TdG9yZTtcbiAgbG9hZFJ1bGVzOiBIb29rSWdub3JlTG9hZGVyO1xuICBsb2dnZXI6IENvcmVMb2dnZXI7XG59XG5cbi8qKlxuICogR2l2ZW4gYSByZXBvLXJlbGF0aXZlIHBhdGggYW5kIHRoZSBsaW5lIHJhbmdlIGJlaW5nIHRvdWNoZWQgd2l0aGluIGFuXG4gKiBhbHJlYWR5LXJlc29sdmVkIHJlcG8sIHByb2R1Y2UgdGhlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gIGJsb2NrIGZvciB0aGVcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoYXQgcmFuZ2UsIG9yIG51bGwgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHRvIHN1cmZhY2UuXG4gKlxuICogVGhlIHBpcGVsaW5lOiBgZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5gIFx1MjE5MiBrZWVwIGxpbmUtcmFuZ2VkIGFuY2hvcnMgb25cbiAqIHRoZSBzYW1lIGZpbGUgdGhhdCBpbnRlcnNlY3QgdGhlIHJhbmdlIGFuZCBhcmUgbm90IGAuaG9va2lnbm9yZWAtc3VwcHJlc3NlZCBcdTIxOTJcbiAqIGRyb3Agc2x1Z3MgYWxyZWFkeSBzdXJmYWNlZCB0aGlzIHNlc3Npb24gKG1lbW8pIFx1MjE5MiByZW5kZXIgYGdpdCBzcGFuIGxpc3RcbiAqIDxuYW1lc1x1MjAyNj5gIFx1MjE5MiBhcHBlbmQgYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIgZm9yIGFueSBhbHJlYWR5LWRyaWZ0ZWRcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBkcmlmdC1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIGRyaWZ0RXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBkcmlmdGVkIFx1MjAxNCB0aGUgdG91Y2hlZCBsaW5lcyBoYXZlXG4gIC8vIGRyaWZ0ZWQgZnJvbSB0aGVpciBhbmNob3JlZCBzdGF0ZSBcdTIwMTQgd2l0aCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlci5cbiAgLy8gRGV0ZWN0aW9uIGlzIGFzLW9mLW5vdyAoc3VyZmFjaW5nIHJ1bnMgYmVmb3JlIHRoZSBlZGl0IGFwcGxpZXMpLCBzbyB0aGlzXG4gIC8vIGNhdGNoZXMgcHJlLWV4aXN0aW5nIGRyaWZ0OyBkcmlmdCB0aGlzIHNlc3Npb24gY2F1c2VzIGlzIHRoZSBTdG9wIGhvb2sncyBqb2IuXG4gIC8vIEZhaWx1cmUgdG8gY29tcHV0ZSBkcmlmdCBpcyBub24tZmF0YWw6IGZhbGwgYmFjayB0byB0aGUgcGxhaW4gYmxvY2suXG4gIGxldCBkcmlmdEhpbnQgPSAnJztcbiAgdHJ5IHtcbiAgICBjb25zdCBkcmlmdE5hbWVzID0gbmV3IFNldChwYXJzZURyaWZ0UG9yY2VsYWluKGRyaWZ0RXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCkpLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgY29uc3QgZHJpZnRTdXJmYWNlZCA9IHRvU3VyZmFjZS5maWx0ZXIoKG4pID0+IGRyaWZ0TmFtZXMuaGFzKG4pKTtcbiAgICBpZiAoZHJpZnRTdXJmYWNlZC5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBsaW5lcyA9IGRyaWZ0U3VyZmFjZWQubWFwKChuKSA9PiBgICBnaXQgc3BhbiBoaXN0b3J5ICR7bn1gKS5qb2luKCdcXG4nKTtcbiAgICAgIGRyaWZ0SGludCA9IGBcXG5EcmlmdCBcdTIwMTQgdGhlIGxpbmVzIHlvdSdyZSB0b3VjaGluZyBoYXZlIGRyaWZ0ZWQgZnJvbSB0aGVzZSBzcGFucycgYW5jaG9yZWQgc3RhdGUuIFJldmlldyBob3cgZWFjaCBzdWJzeXN0ZW0gZXZvbHZlZCBiZWZvcmUgY2hhbmdpbmcgaXQ6XFxuJHtsaW5lc31gO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGRyaWZ0IChoaXN0b3J5IGhpbnQpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICB9XG5cbiAgY29uc3Qgd3JhcHBlZCA9IGBcXG48Z2l0LXNwYW4+XFxuJHtyZW5kZXJTdGRvdXR9JHtkcmlmdEhpbnR9XFxuPC9naXQtc3Bhbj5cXG5gO1xuXG4gIC8vIFVwZGF0ZSBtZW1vXG4gIG1lbW8uYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCB0b1N1cmZhY2UpO1xuXG4gIHJldHVybiB3cmFwcGVkO1xufVxuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBpdCBpcyBuZXZlciBzdXJmYWNlZCBpbiB0aGUgaW5saW5lXG4gKiBgPGdpdC1zcGFuPmAgYmxvY2sgdGhlIGBQb3N0VG9vbFVzZWAgdG91Y2ggaG9vayBlbWl0cy4gSXQgaGFzIG5vIGVmZmVjdCBvblxuICogdGhlIGBQcmVUb29sVXNlYCBhZHZpc29yLCB3aG9zZSBvd24gdW5jb3ZlcmVkLXdyaXRlcyBzdXBwcmVzc2lvbiBsaXZlcyBpblxuICogYC5zcGFuLy5hZHZpc29yaWdub3JlYCAoc2VlIGBhZHZpc29yLWlnbm9yZS50c2ApLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmFkdmlzb3JpZ25vcmVgXG4gKiBpbiBgYWR2aXNvci1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgdG91Y2gtaG9vayBjb3JlLlxuICpcbiAqIFRoaXMgbW9kdWxlIGltcGxlbWVudHMgdGhlIFBvc3RUb29sVXNlIFwidG91Y2ggc2lnbmFsXCIgdGhhdCBib3RoIHRoZSBDbGF1ZGVcbiAqIChgUmVhZHxFZGl0fFdyaXRlYCkgYW5kIENvZGV4IChgYXBwbHlfcGF0Y2hgKSBhZGFwdGVycyBkcml2ZS4gSXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICoge0BsaW5rIFRvdWNoSW5wdXR9LCBpbmplY3QgZXhlY3V0aW9uL3N0YXRlIGRlcGVuZGVuY2llcywgYW5kIHdyYXAgdGhlIHJldHVybmVkXG4gKiB7QGxpbmsgVG91Y2hPdXRwdXR9IGluIHRoZWlyIG93biBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBSZXVzZWQgZnJvbSB0aGUgc2hhcmVkIGtlcm5lbCAobm90IHJlZGVmaW5lZCk6IGBpc0RlYnQoKWAgK1xuICogYFBvcmNlbGFpblN0YXR1c2AvYERyaWZ0UG9yY2VsYWluUm93YC9gUG9yY2VsYWluUm93YC9gcGFyc2VQb3JjZWxhaW5gL1xuICogYHBhcnNlRHJpZnRQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBgcmFuZ2VzSW50ZXJzZWN0YCBhbmQgdGhlXG4gKiByZXBvL3NwYW4tcm9vdCBwYXRoIHV0aWxpdGllcyAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYW5kIHRoZSBgTWVtb1N0b3JlYFxuICogY2FkZW5jZSBzdG9yZSAoc3Bhbi1zdXJmYWNlLnRzKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICB0eXBlIERyaWZ0UG9yY2VsYWluUm93LFxuICBodW1hblN0YXR1c0xhYmVsLFxuICBpc0RlYnQsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgdHlwZSBQb3JjZWxhaW5TdGF0dXMsXG4gIHBhcnNlRHJpZnRQb3JjZWxhaW4sXG4gIHBhcnNlUG9yY2VsYWluLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjb2xsYXBzZUJ5UGF0aCwgdHlwZSBSYW5nZUxhYmVsLCByZW5kZXJBbmNob3JUcmVlIH0gZnJvbSAnLi9hbmNob3ItdHJlZS5qcyc7XG5pbXBvcnQgdHlwZSB7IE1lbW9TdG9yZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LWVkaXQgcmFuZ2UgcmVjb3Zlcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNwbGl0IHdyaXR0ZW4gY29udGVudCBpbnRvIHRoZSBsaW5lcyB0byBsb2NhdGUgb24gZGlzay4gQSBzaW5nbGUgdHJhaWxpbmdcbiAqIG5ld2xpbmUgaXMgZHJvcHBlZCBzbyBgXCJhXFxuYlxcblwiYCBhbmQgYFwiYVxcbmJcImAgbG9jYXRlIGlkZW50aWNhbGx5OyBhbiBlbXB0eVxuICogKG9yIG5ld2xpbmUtb25seSkgd3JpdGUgaGFzIG5vIGxvY2F0YWJsZSBibG9jay5cbiAqL1xuZnVuY3Rpb24gdG9OZWVkbGVMaW5lcyh3cml0dGVuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGlmICh3cml0dGVuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCB0cmltbWVkID0gd3JpdHRlbi5lbmRzV2l0aCgnXFxuJykgPyB3cml0dGVuLnNsaWNlKDAsIC0xKSA6IHdyaXR0ZW47XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICByZXR1cm4gdHJpbW1lZC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKlxuICogUmVjb3ZlciB0aGUgbGluZSByYW5nZSB0aGF0IHdyaXR0ZW4gY29udGVudCBub3cgb2NjdXBpZXMgaW4gdGhlIG9uLWRpc2sgZmlsZSxcbiAqIGZvciBhbmNob3JpbmcgdGhlIHRvdWNoZWQgcmVnaW9uIGFmdGVyIGFuIGVkaXQgaGFzIGFscmVhZHkgYXBwbGllZC5cbiAqXG4gKiBUaGlzIGdlbmVyYWxpemVzIHRoZSBwcmUtZWRpdCBgbG9jYXRlQ2h1bmsoKWAgdGVjaG5pcXVlIGluXG4gKiBbYXBwbHktcGF0Y2gudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NvZGV4L2FwcGx5LXBhdGNoLnRzI0wyNTMtTDI4NilcbiAqIChwcmV2aW91c2x5IENvZGV4LW9ubHkpIGludG8gYSBzaGFyZWQgcG9zdC1lZGl0IHByaW1pdGl2ZSBib3RoIGhhcm5lc3NlcyB1c2U6XG4gKiBzcGxpdCBgd3JpdHRlbmAgYW5kIGBvbkRpc2tDb250ZW50YCBpbnRvIGxpbmVzIGFuZCBsb2NhdGUgdGhlIHdyaXR0ZW4gYmxvY2sgYXNcbiAqIGEgY29udGlndW91cyBydW4gaW5zaWRlIHRoZSBvbi1kaXNrIGxpbmVzLlxuICpcbiAqIC0gQSBzaW5nbGUgY29udGlndW91cyBtYXRjaCB5aWVsZHMgaXRzIDEtYmFzZWQgaW5jbHVzaXZlIHtAbGluayBMaW5lUmFuZ2V9LlxuICogLSBXaGVuIHRoZSBibG9jayBpcyBhYnNlbnQsIG9yIGFwcGVhcnMgbW9yZSB0aGFuIG9uY2UgKGNvbnRleHQgdG8gZGlzYW1iaWd1YXRlXG4gKiAgIGlzIG5vdCBhdmFpbGFibGUgcG9zdC1lZGl0KSwgcmVjb3ZlcnkgaXMgYW1iaWd1b3VzIGFuZCB0aGUgcmVzdWx0IGRlZ3JhZGVzXG4gKiAgIHRvIGAnd2hvbGUtZmlsZSdgICh0aGUgc2FtZSBmYWxsYmFjayBgbG9jYXRlQ2h1bmsoKWAgc2lnbmFscyB3aXRoIGBudWxsYCkuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhbiB1bmxvY2F0YWJsZSB3cml0ZSBpcyBhIGAnd2hvbGUtZmlsZSdgIGFuc3dlciwgbm90IGFuIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3ZlclJhbmdlKHdyaXR0ZW46IHN0cmluZywgb25EaXNrQ29udGVudDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgY29uc3QgbmVlZGxlID0gdG9OZWVkbGVMaW5lcyh3cml0dGVuKTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG5cbiAgY29uc3QgaGF5c3RhY2sgPSBvbkRpc2tDb250ZW50LnNwbGl0KCdcXG4nKTtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGNvbnN0IHN0YXJ0czogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPD0gbGFzdDsgaSsrKSB7XG4gICAgbGV0IG9rID0gdHJ1ZTtcbiAgICBmb3IgKGxldCBqID0gMDsgaiA8IG5lZWRsZS5sZW5ndGg7IGorKykge1xuICAgICAgaWYgKGhheXN0YWNrW2kgKyBqXSAhPT0gbmVlZGxlW2pdKSB7XG4gICAgICAgIG9rID0gZmFsc2U7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob2spIHtcbiAgICAgIHN0YXJ0cy5wdXNoKGkpO1xuICAgICAgaWYgKHN0YXJ0cy5sZW5ndGggPiAxKSBicmVhazsgLy8gZHVwbGljYXRlZCBcdTIxOTIgYW1iaWd1b3VzLCBzdG9wIGVhcmx5XG4gICAgfVxuICB9XG5cbiAgaWYgKHN0YXJ0cy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4geyBzdGFydDogc3RhcnRzWzBdICsgMSwgZW5kOiBzdGFydHNbMF0gKyBuZWVkbGUubGVuZ3RoIH07XG4gIH1cbiAgcmV0dXJuICd3aG9sZS1maWxlJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBpbnB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogV2hpY2ggaGFybmVzcyBldmVudCBmaXJlZCwgYXMgdGhlIHRvdWNoIGNvcmUgc2VlcyBpdC4gVGhlIGNvcmUgYnJhbmNoZXMgb25cbiAqIHRoaXM6IGB3cml0ZWAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIGFuZCBtYXkgc3VyZmFjZSBhXG4gKiBtZXJnZWQgYmxvY2s7IGByZWFkYCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlIGFuZCBmaWx0ZXJzIHBvc2l0aW9uYWwgc3RhdHVzZXNcbiAqIG91dCBvZiB3aGF0IGl0IHN1cmZhY2VzLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaEV2ZW50S2luZCA9ICdyZWFkJyB8ICd3cml0ZSc7XG5cbi8qKiBGaWVsZHMgc2hhcmVkIGJ5IGV2ZXJ5IHRvdWNoLCByZWdhcmRsZXNzIG9mIGtpbmQuICovXG5pbnRlcmZhY2UgVG91Y2hJbnB1dEJhc2Uge1xuICAvKiogSGFybmVzcyBzZXNzaW9uIGlkIFx1MjAxNCBrZXlzIHRoZSBwZXItc2Vzc2lvbiBjYWRlbmNlIHtAbGluayBNZW1vU3RvcmV9LiAqL1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdvcmtpbmcgZGlyZWN0b3J5IHRoZSB0b29sIHJhbiBpbiwgdXNlZCB0byBib3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvXG4gICAqIHZpYSBgcmVzb2x2ZVRvdWNoU2NvcGUoKWAgYmVmb3JlIGFueSBzcGFuIGludm9jYXRpb24uXG4gICAqL1xuICBjd2Q6IHN0cmluZztcbiAgLyoqIEFic29sdXRlLCBjYW5vbmljYWxpemVkIHBhdGggb2YgdGhlIHRvdWNoZWQgZmlsZS4gKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqIEEgcmVhZCB0b3VjaCAoQ2xhdWRlIGBSZWFkYCwgb3IgYSByZWFkLXNoYXBlZCBDb2RleCBldmVudCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoUmVhZElucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAncmVhZCc7XG4gIC8qKlxuICAgKiAxLWJhc2VkIHN0YXJ0aW5nIGxpbmUgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBvZmZzZXRgXG4gICAqIGlucHV0LiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgb2Zmc2V0YCAocmVhZHMgZnJvbSBsaW5lIDEpLlxuICAgKi9cbiAgb2Zmc2V0PzogbnVtYmVyO1xuICAvKipcbiAgICogTGluZSBjb3VudCBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYGxpbWl0YCBpbnB1dC5cbiAgICogYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYGxpbWl0YCBcdTIwMTQgc2VlIHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9XG4gICAqIGZvciBob3cgdGhlIHJhbmdlIGlzIGNvbXB1dGVkIGluIHRoYXQgY2FzZS5cbiAgICovXG4gIGxpbWl0PzogbnVtYmVyO1xufVxuXG4vKiogQSB3cml0ZSB0b3VjaCAoQ2xhdWRlIGBFZGl0YC9gV3JpdGVgLCBDb2RleCBgYXBwbHlfcGF0Y2hgLCBvciBhIHRyYW5zbGF0ZWQgQmFzaCB3cml0ZSBzcGFuKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hXcml0ZUlucHV0IGV4dGVuZHMgVG91Y2hJbnB1dEJhc2Uge1xuICBraW5kOiAnd3JpdGUnO1xuICAvKipcbiAgICogVGhlIGNvbnRlbnQganVzdCB3cml0dGVuIHRvIGBmaWxlUGF0aGAsIGZlZCB0byB7QGxpbmsgcmVjb3ZlclJhbmdlfSB0b1xuICAgKiByZS1hbmNob3IgdGhlIHRvdWNoZWQgcmVnaW9uIGFnYWluc3QgdGhlIGhlYWxlZCBvbi1kaXNrIGZpbGUuIEZvciBhXG4gICAqIHdob2xlLWZpbGUgY3JlYXRlIHRoaXMgaXMgdGhlIGVudGlyZSBmaWxlIGJvZHk7IGFuIGVtcHR5IHN0cmluZyBtZWFuc1xuICAgKiBcIm5vIGxvY2F0YWJsZSBibG9ja1wiIGFuZCB0aGUgdG91Y2ggaXMgc2NvcGVkIGZpbGUtd2lkZS5cbiAgICovXG4gIHdyaXR0ZW46IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHBvc3QtZWRpdCByYW5nZSB3aGVuIHN0YXRpY2FsbHkga25vd24gKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcyxcbiAgICogcGF0Y2ggaHVuayB1bmlvbnMpOyBieXBhc3NlcyB7QGxpbmsgcmVjb3ZlclJhbmdlRnJvbURpc2t9IChwbGFuIFx1MDBBNzNcbiAgICogc3RlcCAzKS5cbiAgICovXG4gIHJhbmdlPzogTGluZVJhbmdlO1xuICAvKipcbiAgICogVGhlIGZpbGUncyBleHBlY3RlZCBwb3N0LWNvbW1hbmQgc3RhdGU7IHRoZSB3cml0ZSBwYXRoIGdhdGVzIG9uIGl0IGJlZm9yZVxuICAgKiBpbnZva2luZyBhbnkgZXhlY3V0b3IgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLiBBYnNlbnQgbWVhbnMgYCdleGlzdHMnYCBcdTIwMTQgdGhlXG4gICAqIEVkaXQvV3JpdGUgYW5kIGFwcGx5X3BhdGNoIHBhdGhzJyBkZWZhdWx0LlxuICAgKi9cbiAgdGFyZ2V0U3RhdGU/OiAnZXhpc3RzJyB8ICdhYnNlbnQnO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQsIHZlcmlmaWVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAgICogY2FsbCAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBgY29udGVudGAgY29tcGFyZXMgdGhlIG9uLWRpc2sgc3RhdGUgYWZ0ZXIgdGhlXG4gICAqIGNvbW1hbmQgcmFuOyBgcmVhbERlbGV0ZWAgaXMgZGVsZXRlLW9ubHkgXHUyMDE0IHRoZSBwYXRoIG11c3QgYWxzbyBiZVxuICAgKiBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLlxuICAgKi9cbiAgcG9zdFN0YXRlPzoge1xuICAgIC8qKiBgZXhhY3RgOiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YDogZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YDogemVybyBieXRlczsgYHNpemVgOiBieXRlIGNvdW50LiAqL1xuICAgIGNvbnRlbnQ/OiBUb3VjaFBvc3RDb250ZW50O1xuICAgIC8qKiBkZWxldGUtb25seTogdGhlIHBhdGggbXVzdCBhbHNvIGJlIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCAocHJvYmVzIGNhY2hlZCBwZXIgY29tbWFuZCkuICovXG4gICAgcmVhbERlbGV0ZT86IGJvb2xlYW47XG4gIH07XG4gIC8qKlxuICAgKiBjcC9pbnN0YWxsIGRlc3RpbmF0aW9uLXZzLXNvdXJjZSB2ZXJpZmljYXRpb24gKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYVxuICAgKiBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlXG4gICAqIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocmVhbCArIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXJcbiAgICogc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyBcdTIwMTQgdGhlIGRyaXZlcidzIHBhc3MtQSBob2xkKS4gU2V0IGJ5IHRoZVxuICAgKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgY3AgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBuZXZlciBzZXRcbiAgICogYnkgYWRhcHRlcnMuIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZCBcdTIwMTRcbiAgICogc3RyaXBwZWQgb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICogZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzb3VyY2VQYXRoPzogc3RyaW5nO1xuICAvKipcbiAgICogbXYvZ2l0IG12L3BhdGNoIHJlbmFtZSBzb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IHRoZVxuICAgKiBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIFx1MjAxNFxuICAgKiBhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzXG4gICAqIG5ldmVyIHRvdWNoZWQuIE5vIGNvbnRlbnQgY29tcGFyaXNvbiAocGF0Y2ggcmVuYW1lcyBtYXkgY2hhbmdlIGNvbnRlbnQpLlxuICAgKiBTZXQgYnkgdGhlIGBydW5CYXNoVG91Y2hlc2AgZHJpdmVyIG9uIHBhaXJlZCByZW5hbWUtY29weSB0b3VjaGVzLlxuICAgKi9cbiAgcmVuYW1lU291cmNlUGF0aD86IHN0cmluZztcbn1cblxuLyoqIFRoZSBoYXJuZXNzLWFnbm9zdGljIHRvdWNoIHRoZSBjb3JlIGNvbnN1bWVzLiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hJbnB1dCA9IFRvdWNoUmVhZElucHV0IHwgVG91Y2hXcml0ZUlucHV0O1xuXG4vKipcbiAqIEEgc3RhdGljYWxseSBrbm93YWJsZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogYGV4YWN0YCBcdTIwMTRcbiAqIGZpbGUgYnl0ZXMgZXF1YWw7IGBzdWZmaXhgIFx1MjAxNCBmaWxlIGNvbnRlbnQgZW5kcyB3aXRoIGl0OyBgZW1wdHlgIFx1MjAxNCB6ZXJvXG4gKiBieXRlczsgYHNpemVgIFx1MjAxNCBieXRlIGNvdW50LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFBvc3RDb250ZW50ID0geyBleGFjdDogc3RyaW5nIH0gfCB7IHN1ZmZpeDogc3RyaW5nIH0gfCB7IGVtcHR5OiB0cnVlIH0gfCB7IHNpemU6IG51bWJlciB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3Qtc3RhdGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBvdXRjb21lIG9mIHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX06IGEgZGVjaXNpdmUgcGFzcy9mYWlsIGNhcnJpZXNcbiAqIHZlcmRpY3Qgd2VpZ2h0IChjb250ZW50IHZlcmlmaWVkLCBvciBhYnNlbmNlICsgZGVsZXRlLXJlYWxpdHkgdmVyaWZpZWQpO1xuICogYCdpbmNvbmNsdXNpdmUnYCBpcyBldmVyeXRoaW5nIGVsc2UgXHUyMDE0IHRoZSBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgKHNlZCAtaSxcbiAqIHBhdGNoL2dpdCBhcHBseSwgZm9ybWF0dGVycywgcmVzdG9yZS9jaGVja291dCkgd2hvc2UgZXhpc3RlbmNlIHBhc3MgcHJvdmVzXG4gKiBub3RoaW5nLCBhbmQgcHJvYmUtaW5hcHBsaWNhYmxlIGNhc2VzIChwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWRcbiAqIGRlbGV0ZXMsIGRpcmVjdG9yeSB0YXJnZXRzKS4gYCdwZW5kaW5nJ2AgaXMgdGhlIGRyaXZlcidzIGFic2VudC1zb3VyY2UgaG9sZFxuICogKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhbiBhYnNlbnQgY3Agc291cmNlIHRoYXQgcGFzc2VkIHRoZSByZWFsaXR5IHByb2JlIGNhbm5vdFxuICogZGVjaWRlIGl0cyBkZXN0aW5hdGlvbiB1bnRpbCB0aGUgcGFzcy1BIGV4cGxhbmF0aW9uIG1hcCBpcyBjb21wbGV0ZS5cbiAqL1xuZXhwb3J0IHR5cGUgV3JpdGVHYXRlT3V0Y29tZSA9ICdkZWNpc2l2ZVBhc3MnIHwgJ2RlY2lzaXZlRmFpbCcgfCAnaW5jb25jbHVzaXZlJyB8ICdwZW5kaW5nJztcblxuLyoqXG4gKiBQZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eSBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiBvbmUgYGdpdFxuICogbHMtZmlsZXMgLS1lcnJvci11bm1hdGNoYCBhbmQgb25lIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCBiYXRjaCBwZXJcbiAqIGNvbW1hbmQsIG5ldmVyIG9uZSBwZXIgcGF0aCwgbWVtYmVyc2hpcCBmcm9tIHByaW50ZWQgcm93cy4gVGhlXG4gKiBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBzZWVkcyBpdCB3aXRoIGV2ZXJ5IGFic2VudCB0YXJnZXQgYW5kIGNwL2luc3RhbGxcbiAqIHNvdXJjZSBvZiB0aGUgY29tcG91bmQgYW5kIHNoYXJlcyBpdCBpbnRvIHBhc3MgQiBzbyBzdXJ2aXZpbmcgZGVsZXRlc1xuICogcmUtZ2F0ZSB3aXRob3V0IHJlLXByb2JpbmcuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVhbGl0eVByb2JlQ2FjaGUge1xuICAvKiogRGlzdGluY3QgYWJzb2x1dGUgcGF0aHMgdG8gcHJvYmUsIGluIGZpcnN0LXNlZW4gb3JkZXIuICovXG4gIHBhdGhzOiBzdHJpbmdbXTtcbiAgLyoqIExhenk6IGFic29sdXRlIHBhdGhzIGNvbmZpcm1lZCBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQsIGNvbXB1dGVkIG9uY2UuICovXG4gIHJlYWxQYXRoczogU2V0PHN0cmluZz4gfCBudWxsO1xufVxuXG4vKiogQ3JlYXRlIGEgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgZm9yIHRoZSBnaXZlbiBhYnNvbHV0ZSBwYXRocy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwYXRoczogSXRlcmFibGU8c3RyaW5nPik6IFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgcmV0dXJuIHsgcGF0aHM6IFsuLi5uZXcgU2V0KHBhdGhzKV0sIHJlYWxQYXRoczogbnVsbCB9O1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBleGlzdHMgb24gZGlzayAoYW55IG5vZGUga2luZCk7IGBmYWxzZWAgb24gYW55IHN0YXQgZmFpbHVyZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxlRXhpc3RzKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGZzLnN0YXRTeW5jKGFic1BhdGgpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYSByZWd1bGFyIGZpbGUgXHUyMDE0IGEgZGlyZWN0b3J5IHRhcmdldCBmYWlscyB0aGUgYCdleGlzdHMnYCBnYXRlLiAqL1xuZnVuY3Rpb24gaXNGaWxlT25EaXNrKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhhYnNQYXRoKS5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVmVyaWZ5IGEgc3RhdGljYWxseSBrbm93YWJsZSBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gYWdhaW5zdCB0aGUgb24tZGlza1xuICogZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBBbnkgcmVhZCBmYWlsdXJlIGlzIGEgbWlzbWF0Y2gsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiBjb250ZW50TWF0Y2hlcyhwb3N0OiBUb3VjaFBvc3RDb250ZW50LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgaWYgKCdleGFjdCcgaW4gcG9zdCkgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKSA9PT0gcG9zdC5leGFjdDtcbiAgICBpZiAoJ3N1ZmZpeCcgaW4gcG9zdCkge1xuICAgICAgLy8gVGhlIHNoZWxsIGFwcGVuZHMgdGhlIGJvZHkgcGx1cyBpdHMgdGVybWluYXRpbmcgbmV3bGluZTsgdGhlIGhlcmVkb2NcbiAgICAgIC8vIGdyYW1tYXIgc3RyaXBzIGV4YWN0bHkgdGhhdCBvbmUgYFxcbmAgZnJvbSBgc3Bhbi53cml0dGVuYFxuICAgICAgLy8gKHBhcnNlLWNvbW1hbmQudHMgaGVyZWRvYyBib2R5IGV4dHJhY3Rpb24pLCBzbyBhIGZpbGUgZW5kaW5nXG4gICAgICAvLyBgd3JpdHRlblxcbmAgaXMgdGhlIHNhbWUgYXBwZW5kZWQgdGV4dCBhcyBgd3JpdHRlbmAgXHUyMDE0IGFjY2VwdCBib3RoLlxuICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgIHJldHVybiBjb250ZW50LmVuZHNXaXRoKHBvc3Quc3VmZml4KSB8fCBjb250ZW50LmVuZHNXaXRoKGAke3Bvc3Quc3VmZml4fVxcbmApO1xuICAgIH1cbiAgICBpZiAoJ2VtcHR5JyBpbiBwb3N0KSByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IDA7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSBwb3N0LnNpemU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiBsYXppbHkgcnVuIHRoZSB0d28gcGVyLWNvbW1hbmRcbiAqIGJhdGNoZXMgYW5kIGNhY2hlIHRoZSBjb25maXJtZWQtcmVhbCBwYXRoIHNldC4gTWVtYmVyc2hpcCBjb21lcyBmcm9tIHRoZVxuICogcHJpbnRlZCByb3dzLCBub3QgdGhlIGV4aXQgY29kZSBcdTIwMTQgYGdpdCBscy1maWxlcyAtLWVycm9yLXVubWF0Y2hgIHByaW50c1xuICogZXZlcnkgdHJhY2tlZCBwYXRoIGV2ZW4gd2hlbiBpdCBleGl0cyBub256ZXJvIChhbnkgbWlzc2luZyBwYXRoKSwgYW5kXG4gKiBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgcHJpbnRzIG5vdGhpbmcgZm9yIHBoYW50b20gb3Iga25vd24tYnV0LVxuICogdW5zcGFubmVkIHBhdGhzIChleGl0IDAgd2l0aCBcIk5vIHNwYW5zIG1hdGNoIHRoZSBmaWx0ZXJzXCIpLiBBIHBsYWluLWBybWAnZFxuICogdHJhY2tlZCBmaWxlIGtlZXBzIGl0cyBpbmRleCBlbnRyeSAobHMtZmlsZXMgZXhpdCAwIFx1MjAxNCB0aGUgcHJvYmUgZmlyZXMpO1xuICogYGdpdCBybWAgcmVtb3ZlcyBpdCAobHMtZmlsZXMgMTI4KSBzbyBvbmx5IHNwYW5uZWQgZmlsZXMgc3RheSByZWFsLiBBXG4gKiBwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWQgcGF0aCBmYWlscyBib3RoIHByb2JlcyBcdTIwMTQgdGhlIGRlbGV0ZSBkZWdyYWRlc1xuICogdG8gYCdpbmNvbmNsdXNpdmUnYCBhbmQgbmV2ZXIgZmlyZXMuIEZhaWwtc2FmZTogYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3IgYVxuICogcHJvYmUgZmFpbHVyZSB5aWVsZHMgYW4gZW1wdHkgc2V0LCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVhbFBhdGhzKGNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gIGlmIChjYWNoZS5yZWFsUGF0aHMgIT09IG51bGwpIHJldHVybiBjYWNoZS5yZWFsUGF0aHM7XG4gIGNvbnN0IHJlYWwgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgaWYgKGNhY2hlLnBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGlmIChyZXBvUm9vdCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVscyA9IGNhY2hlLnBhdGhzLm1hcCgocCkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIHApKTtcbiAgICAgIGNvbnN0IGNhcHR1cmUgPSAoYXJnczogc3RyaW5nW10pOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgICAgICAgIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zdCBzdGRvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiBudWxsO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY29uc3QgbHNGaWxlcyA9IGNhcHR1cmUoWydscy1maWxlcycsICctLWVycm9yLXVubWF0Y2gnLCAnLS0nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAobHNGaWxlcyAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbHNGaWxlcy5zcGxpdCgnXFxuJykpIHtcbiAgICAgICAgICBjb25zdCByZWwgPSBsaW5lLnRyaW0oKTtcbiAgICAgICAgICBpZiAocmVsLmxlbmd0aCA+IDApIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJlbCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBzcGFuTGlzdCA9IGNhcHR1cmUoWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAoc3Bhbkxpc3QgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgcGFyc2VQb3JjZWxhaW4oc3Bhbkxpc3QpKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByb3cucGF0aCkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBjYWNoZS5yZWFsUGF0aHMgPSByZWFsO1xuICByZXR1cm4gcmVhbDtcbn1cblxuLyoqXG4gKiBUaGUgbGF5ZXJlZCBwb3N0LXN0YXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLCBldmFsdWF0ZWQgYmVmb3JlIGFueSBleGVjdXRvclxuICogY2FsbCwgc2lkZS1lZmZlY3QtZnJlZSAobm8gbWVtbyB3cml0ZXMsIG5vIGV4ZWN1dG9yIGNhbGxzOyB0aGUgcHJvYmUgaXNcbiAqIHJlYWQtb25seSBhbmQgcGVyLWNvbW1hbmQgY2FjaGVkKTpcbiAqXG4gKiAxLiBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIxOTIgdGhlIHBhdGggbXVzdCBiZSBhYnNlbnQ7IHdoZW4gaXQgaXMsIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgZGVjaWRlczogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIFx1MjE5MiBgZGVjaXNpdmVQYXNzYFxuICogICAgKGRhbmdsaW5nIGFuY2hvcnMgc3VyZmFjZSksIHBoYW50b20gXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AgKG5vdGhpbmcgdG9cbiAqICAgIHN1cmZhY2UgXHUyMDE0IHRoZSBtaXNzIGlzIGhhcm1sZXNzLCBhbmQgdGhlIGRlbGV0ZSBuZXZlciBmaXJlcykuXG4gKiAyLiBgdGFyZ2V0U3RhdGU6ICdleGlzdHMnYCBcdTIxOTIgdGhlIHRhcmdldCBtdXN0IGJlIGEgcmVndWxhciBmaWxlIChhIGRpcmVjdG9yeVxuICogICAgb3IgbWlzc2luZyB0YXJnZXQgZmFpbHMpLlxuICogMy4gQ29udGVudCB2ZXJpZmljYXRpb24gd2hlcmUgdGhlIGV4cGVjdGVkIHBvc3QtY29udGVudCBpcyBzdGF0aWNhbGx5XG4gKiAgICBrbm93YWJsZSAoYGV4YWN0YC9gc3VmZml4YC9gZW1wdHlgL2BzaXplYCk6IGEgbWlzbWF0Y2ggbWVhbnMgdGhlIHdyaXRlJ3NcbiAqICAgIGVmZmVjdCBpcyBhYnNlbnQgXHUyMDE0IG5vIHRvdWNoLlxuICogNC4gY3AgZGVzdGluYXRpb24tdnMtc291cmNlOiBhIHN0aWxsLXByZXNlbnQgc291cmNlIG11c3QgYnl0ZS1lcXVhbCB0aGVcbiAqICAgIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGFzc2VkIHRoZVxuICogICAgcmVhbGl0eSBwcm9iZSBBTkQgaXRzIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoXG4gKiAgICBgZGVjaXNpdmVQYXNzYCBcdTIwMTQgdGhlIGRyaXZlciByZXNvbHZlcyB0aGUgYCdwZW5kaW5nJ2AgaG9sZCkuXG4gKiA1LiByZW5hbWUtY29weTogdGhlIGRlc3RpbmF0aW9uIGZpcmVzIG9ubHkgd2hlbiBpdHMgc291cmNlIHBhc3NlZCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCkuXG4gKlxuICogRXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZyBcdTIwMTQgaXMgYCdpbmNvbmNsdXNpdmUnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0OiBUb3VjaFdyaXRlSW5wdXQsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmIChpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2luY29uY2x1c2l2ZSc7XG4gIH1cblxuICBpZiAoIWlzRmlsZU9uRGlzayhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcblxuICBjb25zdCBjb250ZW50ID0gaW5wdXQucG9zdFN0YXRlPy5jb250ZW50O1xuICBpZiAoY29udGVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGNvbnRlbnRNYXRjaGVzKGNvbnRlbnQsIGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQuc291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuc291cmNlUGF0aCkpIHtcbiAgICAgIGxldCBzcmM6IHN0cmluZztcbiAgICAgIGxldCBkc3Q6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIHNyYyA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5zb3VyY2VQYXRoLCAndXRmOCcpO1xuICAgICAgICBkc3QgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNyYyA9PT0gZHN0ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgLy8gQWJzZW50IHNvdXJjZSBcdTIwMTQgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpOiB0aGUgZGVzdFxuICAgIC8vIGZpcmVzIG9ubHkgd2hlbiB0aGUgc291cmNlIHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSAoaXQgd2FzIGEgcmVhbFxuICAgIC8vIGZpbGUpIEFORCBpdHMgYWJzZW5jZSBpcyBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuc291cmNlUGF0aCkgPyAncGVuZGluZycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5yZW5hbWVTb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBObyBjb250ZW50IGNvbXBhcmlzb24gXHUyMDE0IHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50OyBhIHBoYW50b21cbiAgICAvLyBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkIGFuZCBhIHByZS1leGlzdGluZyBkZXN0aW5hdGlvbiB3YXMgbmV2ZXJcbiAgICAvLyB0b3VjaGVkIChwbGFuIFx1MDBBNzMgc3RlcCAxYykuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5yZW5hbWVTb3VyY2VQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCByZW1vdmUgaXRzIG9sZCBhbmNob3IgYmVmb3JlIGFkZGluZyB0aGUgbmV3IG9uZS4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX0gKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHJ1bnMgZmlyc3QgXHUyMDE0XG4gKiAgIGFueSBkZWNpc2l2ZSBmYWlsLCBvciBhbiBpbmNvbmNsdXNpdmUgcGhhbnRvbSBkZWxldGUsIGJsb2NrcyB0aGUgdG91Y2hcbiAqICAgd2l0aCBubyBleGVjdXRvciBjYWxsIFx1MjAxNCB0aGVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPlxuICogICAtLWZpeGApIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmdcbiAqICAgdHJlZSwgYW5kIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGlzIGNvbXB1dGVkIGFnYWluc3QgdGhlIGhlYWxlZFxuICogICBhbmNob3JzLCByZW5kZXJpbmcgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoXG4gKiAgIGFueSByZW1haW5pbmcgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzXG4gKiAgIGRlZHVwZWQgdGhyb3VnaCBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIFRoZSBvcHRpb25hbCBgcHJvYmVDYWNoZWAgc2hhcmVzIHRoZSBkcml2ZXIncyBwZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eVxuICogcHJvYmUgaW50byBwYXNzIEIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dFxuICogcmUtcHJvYmluZzsgZGlyZWN0IGNhbGxlcnMgZ2V0IGEgcGVyLWNhbGwgY2FjaGUgc2VlZGVkIHdpdGggdGhlIHRvdWNoZWRcbiAqIHBhdGggd2hlbiB0aGUgdGFyZ2V0IGlzIGAnYWJzZW50J2AuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcHJvYmVDYWNoZT86IFJlYWxpdHlQcm9iZUNhY2hlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgcHJvYmUgPSBwcm9iZUNhY2hlID8/IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JyA/IFtpbnB1dC5maWxlUGF0aF0gOiBbXSk7XG4gICAgICBjb25zdCBvdXRjb21lID0gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQsIHByb2JlKTtcbiAgICAgIGlmIChvdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyB8fCAob3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSkge1xuICAgICAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gaW5wdXQucmFuZ2UgPz8gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZywgYW5kXG4gICAgICAgIC8vIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgQmFzaCBzcGFuIFx1MjE5MiB0b3VjaCB0cmFuc2xhdGlvbiBhbmQgdGhlIGpvaW4tZ2F0aW5nIGRyaXZlciAocGxhbiBcdTAwQTcyLFxuICogXHUwMEE3MyBzdGVwIDIpLiBCb3RoIGFkYXB0ZXJzIGNvbnN1bWUgdGhpcyBtb2R1bGUgb25jZSB0aGVpciBkdXBsaWNhdGUgQmFzaFxuICogc3BhbiBsb29wcyBjb2xsYXBzZTogaXQgb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0IHBhc3MgQVxuICogYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCwgdGhlIGV4cGxhbmF0aW9uIG1hcCwgdGhlIGpvaW4gZmlsdGVyLCBhbmQgcGFzcyBCXG4gKiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmQgYGludGVycnVwdGVkYFxuICogZ2F0ZSAocGxhbiBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiwgU3Bhbk1hdGNoIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHR5cGUgTWVtb1N0b3JlLCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlLFxuICBldmFsdWF0ZVdyaXRlR2F0ZSxcbiAgZmlsZUV4aXN0cyxcbiAgdHlwZSBSZWFsaXR5UHJvYmVDYWNoZSxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXQsXG4gIHR5cGUgV3JpdGVHYXRlT3V0Y29tZVxufSBmcm9tICcuL3RvdWNoLWNvcmUuanMnO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgcmVzb2x2ZWQgc3BhbiBpbnRvIGEgZnVsbHktdHlwZWQge0BsaW5rIFRvdWNoSW5wdXR9IHBlciB0aGVcbiAqIHBsYW4gXHUwMEE3MiB0YWJsZSwgb3IgYG51bGxgIHdoZW4gdGhlIHBhdGggZmFpbHMgYHJlc29sdmVUb3VjaFNjb3BlYCBcdTIwMTQgY3Jvc3MtXG4gKiByZXBvLCBnaXRpZ25vcmVkLCBhbmQgc3Bhbi1kb2N1bWVudCBwYXRocyBmYWlsIGNsb3NlZC5cbiAqXG4gKiBUaGUgcG9zdC1zdGF0ZSBnYXRlIGZpZWxkcyB0aGUgc3BhbiBjYW4gZGV0ZXJtaW5lIChgdGFyZ2V0U3RhdGVgLCBhbmRcbiAqIGBwb3N0U3RhdGVgIGZvciBhcHBlbmRzIGFuZCBkZWxldGVzKSBhcmUgc2V0IGhlcmU7IGEgbGl0ZXJhbCBvdmVyd3JpdGUgYm9keVxuICogKGBzcGFuLndyaXR0ZW5gIFx1MjAxNCB0aGUgZmxhZy1sZXNzIGBlY2hvYC9gcHJpbnRmYCBgPmAgY2FzZSkgcmlkZXMgYXMgdGhlXG4gKiBgZXhhY3RgIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3RcbiAqIHdoaWxlIHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBUcnVuY2F0ZXMgbWFwXG4gKiB0aGUgc3BhbidzIHN0YXRpY2FsbHkgZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCB0byB0aGUgYHNpemVgIHBvc3QtY29udGVudFxuICogKGAtcyAwYCBcdTIxOTIgYGVtcHR5YCk7IGEgdHJ1bmNhdGUgd2l0aG91dCBhIHNpemUgZ2F0ZXMgZXhpc3RlbmNlLW9ubHkuIFRoZVxuICogZHJpdmVyIHBhaXJzIGNwL2luc3RhbGwgYW5kIG12IHNvdXJjZXMgb250byB0aGUgZGVzdGluYXRpb24gdG91Y2hlc1xuICogYWZ0ZXJ3YXJkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFNwYW5Ub1RvdWNoKHNwYW46IFJlc29sdmVkU3Bhbiwgc2Vzc2lvbklkOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogVG91Y2hJbnB1dCB8IG51bGwge1xuICBpZiAoIXJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpKSByZXR1cm4gbnVsbDtcbiAgc3dpdGNoIChzcGFuLm9wZXJhdGlvbikge1xuICAgIGNhc2UgJ3JlYWQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICBvZmZzZXQ6IHNwYW4ubGluZVN0YXJ0LFxuICAgICAgICBsaW1pdDpcbiAgICAgICAgICBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkICYmIHNwYW4ubGluZUVuZCAhPT0gdW5kZWZpbmVkID8gc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2NyZWF0ZS1vdmVyd3JpdGUnOlxuICAgIGNhc2UgJ3JlbmFtZS1jb3B5JzpcbiAgICAgIC8vIFdob2xlLWZpbGUgd3JpdGVzOiBgd3JpdHRlbjogJydgIHNjb3BlcyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmdcbiAgICAgIC8vIHNwYW4gXHUyMDE0IHRydW5jYXRpbmcgd3JpdGVzIGRlc3Ryb3kgYW5jaG9ycyBiZXlvbmQgdGhlIG5ldyBFT0YgKHRoZVxuICAgICAgLy8gbWFpbi0yMDAgRjIgbGVzc29uKS4gQSBsaXRlcmFsIGJvZHkgcmlkZXMgYXMgdGhlIGV4YWN0IHBvc3QtY29udGVudFxuICAgICAgLy8gZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBleGFjdDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICd0cnVuY2F0ZSc6XG4gICAgICAvLyBTYW1lIHdob2xlLWZpbGUgc2NvcGU7IHRoZSBzaXplIGdhdGUgKHBsYW4gXHUwMEE3MiwgXHUwMEE3MyBzdGVwIDFiKSB2ZXJpZmllc1xuICAgICAgLy8gdGhlIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IHdoZW4gdGhlIHNwYW4gY2FycmllcyBhIHN0YXRpY2FsbHlcbiAgICAgIC8vIGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgKGAtcyAwYCBcdTIxOTIgZW1wdHkpOyB3aXRob3V0IG9uZSB0aGUgZ2F0ZSBpc1xuICAgICAgLy8gZXhpc3RlbmNlLW9ubHkuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6XG4gICAgICAgICAgc3Bhbi5zaXplID09PSAwXG4gICAgICAgICAgICA/IHsgY29udGVudDogeyBlbXB0eTogdHJ1ZSB9IH1cbiAgICAgICAgICAgIDogc3Bhbi5zaXplICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgc2l6ZTogc3Bhbi5zaXplIH0gfVxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdhcHBlbmQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogc3Bhbi53cml0dGVuID8/ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgc3VmZml4OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ21vZGlmeSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICByYW5nZTogc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgc3RhcnQ6IHNwYW4ubGluZVN0YXJ0LCBlbmQ6IHNwYW4ubGluZUVuZCA/PyBzcGFuLmxpbmVTdGFydCB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnLFxuICAgICAgICBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9XG4gICAgICB9O1xuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgQmFzaCBgdG9vbF9yZXNwb25zZWAgc2lnbmFscyB0aGF0IHRoZSBjb21tYW5kIHdhcyBpbnRlcnJ1cHRlZFxuICogKHBsYW4gXHUwMEE3NCkuIFRoZSBTREsgdHlwZXMgdGhlIHJlc3BvbnNlIGB1bmtub3duYCBvbiBib3RoIGFkYXB0ZXJzLCBzbyB0aGlzXG4gKiBpcyBhIGRlZmVuc2l2ZSBydW50aW1lIHNoYXBlLXByb2JlOiBhbiBvYmplY3QgY2FycnlpbmcgYSB0cnV0aHlcbiAqIGBpbnRlcnJ1cHRlZGAgZmllbGQgY2xhc3NpZmllcyBhcyBpbnRlcnJ1cHRlZDsgYW55IG90aGVyIHNoYXBlIChzdHJpbmcsXG4gKiBudWxsLCBvYmplY3Qgd2l0aG91dCB0aGUgZmllbGQpIHByb2NlZWRzIGZhaWwtb3BlbiwgbWF0Y2hpbmcgdG9kYXknc1xuICogYmVoYXZpb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBib29sZWFuIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBCb29sZWFuKCh0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmludGVycnVwdGVkKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBlci1jb21tYW5kIHZlcmRpY3QgZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgUmVzb2x2ZWRNYXRjaCA9IEV4dHJhY3Q8U3Bhbk1hdGNoLCB7IHN0YXR1czogJ3Jlc29sdmVkJyB9PjtcblxudHlwZSBWZXJkaWN0ID0gJ2ZhaWxlZCcgfCAnc3VjY2VlZGVkJyB8ICd1bmtub3duJztcblxuLyoqIE9uZSBwYXNzLUEgZXZhbHVhdGlvbjogdGhlIHNwYW4sIGl0cyB0b3VjaCwgYW5kIHRoZSAocG9zdC1yZXNvbHV0aW9uKSBnYXRlIG91dGNvbWUuICovXG5pbnRlcmZhY2UgU3BhbkV2YWwge1xuICBtYXRjaDogUmVzb2x2ZWRNYXRjaDtcbiAgLyoqIFRoZSB0cmFuc2xhdGVkIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGUgc3BhbiBmYWlsZWQgYHJlc29sdmVUb3VjaFNjb3BlYC4gKi9cbiAgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsO1xuICAvKiogVGhlIHBhc3MtQSBnYXRlIG91dGNvbWUsIHBvc3QtcmVzb2x1dGlvbiBmb3IgYCdwZW5kaW5nJ2AgYW5kIGV4cGxhaW5lZCBmYWlscy4gKi9cbiAgb3V0Y29tZTogV3JpdGVHYXRlT3V0Y29tZTtcbiAgLyoqIEEgZGVjaXNpdmVGYWlsIGRvd25ncmFkZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgZXhwbGFpbmVkOiBib29sZWFuO1xuICBjb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqIFRoZSBzcGFuJ3Mgb3duIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIGRlY2lzaXZlIGZhaWxzLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBjcCBkZXN0aW5hdGlvbnM6IHRoZSBwYWlyZWQgc291cmNlIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIHBlbmRpbmdzLiAqL1xuICBzb3VyY2VLZXk6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogRXZhbHVhdGUgb25lIHNwYW4ncyBnYXRlLiBSZWFkcyBoYXZlIG5vIGdhdGUgXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AsIHdpdGggb25lXG4gKiBleGNlcHRpb246IGNwL2luc3RhbGwgc291cmNlIHJlYWRzIGdhdGUgb24gdGhlIHNvdXJjZSBleGlzdGluZyBwb3N0LWNvbW1hbmRcbiAqIChwbGFuIFx1MDBBNzIpIFx1MjAxNCBhIGZhaWxlZCBjb3B5IG5ldmVyIHJlYWQgYW55dGhpbmcuIFRoZSByZWFkIHZlcmRpY3QgZmxpcHMgb25seVxuICogdGhlIGNvbW1hbmQncyBqb2luIHZlcmRpY3QsIG5ldmVyIHRoZSBzYW1lIGNvbW1hbmQncyBkZXN0IHdyaXRlLlxuICovXG5mdW5jdGlvbiBldmFsU3BhbkdhdGUobWF0Y2g6IFJlc29sdmVkTWF0Y2gsIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKHRvdWNoID09PSBudWxsKSByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIGlmICh0b3VjaC5raW5kID09PSAncmVhZCcpIHtcbiAgICBpZiAoKG1hdGNoLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG1hdGNoLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG1hdGNoLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHJldHVybiBmaWxlRXhpc3RzKG1hdGNoLnNwYW4uYWJzb2x1dGVQYXRoKSA/ICdpbmNvbmNsdXNpdmUnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgfVxuICByZXR1cm4gZXZhbHVhdGVXcml0ZUdhdGUodG91Y2gsIHByb2JlQ2FjaGUpO1xufVxuXG4vKiogVGhlIG9wZXJhdG9yIHByZWNlZGluZyBhIGNvbW1hbmQsIGZyb20gaXRzIGZpcnN0IHNwYW4gKGFsbCBzcGFucyBvZiBvbmUgY29tbWFuZCBzaGFyZSBpdCkuICovXG5mdW5jdGlvbiBqb2luT2ZDb21tYW5kKG1hdGNoZXM6IFJlc29sdmVkTWF0Y2hbXSk6ICcmJicgfCAnfHwnIHwgdW5kZWZpbmVkIHtcbiAgZm9yIChjb25zdCBtIG9mIG1hdGNoZXMpIHtcbiAgICBpZiAobS5zcGFuLmpvaW4gIT09IHVuZGVmaW5lZCkgcmV0dXJuIG0uc3Bhbi5qb2luO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogU2hhcmVkIEJhc2ggZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0XG4gKiBwYXNzIEEgYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCAoZXZlcnkgc3BhbiwgYmVmb3JlIGFueSBqb2luIGRlY2lzaW9uKSxcbiAqIHRoZSBleHBsYW5hdGlvbiBtYXAsIHBlci1jb21tYW5kIHZlcmRpY3RzLCB0aGUgam9pbiBmaWx0ZXIgd2l0aCBjaGFpbmVkXG4gKiBza2lwcywgYW5kIHBhc3MgQiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmRcbiAqIGBpbnRlcnJ1cHRlZGAgZ2F0ZSAocGxhbiBcdTAwQTc0KS4gUmV0dXJucyB0aGUgbm9uLW51bGwgYGFkZGl0aW9uYWxDb250ZXh0YFxuICogYmxvY2tzIGZvciB0aGUgYWRhcHRlciB0byBqb2luOyB0aGUgc2Vzc2lvbiBtZW1vIGRlZHVwcyByZXBlYXRlZCB0YXJnZXRzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmFzaFRvdWNoZXMoXG4gIG1hdGNoZXM6IFNwYW5NYXRjaFtdLFxuICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgY3dkOiBzdHJpbmcsXG4gIHRvb2xSZXNwb25zZTogdW5rbm93bixcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICB3YXJuOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gY29uc29sZS53YXJuXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIC8vIEEgY29tbWFuZCB0aGF0IGRpZCBub3QgY29tcGxldGUgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zLlxuICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlKSkgcmV0dXJuIFtdO1xuICBjb25zdCByZXNvbHZlZCA9IG1hdGNoZXMuZmlsdGVyKChtKTogbSBpcyBSZXNvbHZlZE1hdGNoID0+IG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKTtcbiAgaWYgKHJlc29sdmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIC8vIFNlZWQgdGhlIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYykgd2l0aCBldmVyeSBhYnNlbnRcbiAgLy8gdGFyZ2V0IGFuZCBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQ7IHRoZSBmaXJzdCBnYXRlIHRoYXQgbmVlZHNcbiAgLy8gaXQgcnVucyBvbmUgbHMtZmlsZXMgKyBvbmUgc3Bhbi1saXN0IGJhdGNoIGZvciBhbGwgb2YgdGhlbS5cbiAgY29uc3QgcHJvYmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKSBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgZWxzZSBpZiAoKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgcHJvYmVDYWNoZSA9IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKHByb2JlUGF0aHMpO1xuXG4gIC8vIEdyb3VwIGJ5IHNpbXBsZSBjb21tYW5kIGluIHdhbGtlciBvcmRlci5cbiAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxudW1iZXIsIFJlc29sdmVkTWF0Y2hbXT4oKTtcbiAgY29uc3QgY29tbWFuZE9yZGVyOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBjb25zdCBpZHggPSBtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4O1xuICAgIGNvbnN0IGxpc3QgPSBncm91cHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGlzdC5wdXNoKG0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBncm91cHMuc2V0KGlkeCwgW21dKTtcbiAgICAgIGNvbW1hbmRPcmRlci5wdXNoKGlkeCk7XG4gICAgfVxuICB9XG4gIGNvbW1hbmRPcmRlci5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG5cbiAgLy8gUGFzcyBBOiB0cmFuc2xhdGUgZXZlcnkgc3BhbiBvbmNlIGFuZCBldmFsdWF0ZSBpdHMgZ2F0ZSwgcGFpcmluZ1xuICAvLyBjcC9pbnN0YWxsIHNvdXJjZXMgd2l0aCBkZXN0aW5hdGlvbnMgYW5kIG12IGRlbGV0ZXMgd2l0aCByZW5hbWUtY29waWVzIGJ5XG4gIC8vIGRlY2xhcmF0aW9uIG9yZGVyICh0aGUgcGFyc2VyIGVtaXRzIHNvdXJjZXMgYmVmb3JlIGRlc3RpbmF0aW9ucykuXG4gIGNvbnN0IGV2YWxzID0gbmV3IE1hcDxudW1iZXIsIFNwYW5FdmFsW10+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpITtcbiAgICBjb25zdCByZWFkUGF0aHMgPSBzcGFuc1xuICAgICAgLmZpbHRlcigobSkgPT4gKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpXG4gICAgICAubWFwKChtKSA9PiBtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBjb25zdCBkZWxldGVQYXRocyA9IHNwYW5zLmZpbHRlcigobSkgPT4gbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgbGV0IHJlYWRDdXJzb3IgPSAwO1xuICAgIGxldCBkZWxldGVDdXJzb3IgPSAwO1xuICAgIGNvbnN0IGxpc3Q6IFNwYW5FdmFsW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGNvbnN0IHRvdWNoID0gYmFzaFNwYW5Ub1RvdWNoKG0uc3Bhbiwgc2Vzc2lvbklkLCBjd2QpO1xuICAgICAgY29uc3QgZW50cnk6IFNwYW5FdmFsID0ge1xuICAgICAgICBtYXRjaDogbSxcbiAgICAgICAgdG91Y2gsXG4gICAgICAgIG91dGNvbWU6ICdpbmNvbmNsdXNpdmUnLFxuICAgICAgICBleHBsYWluZWQ6IGZhbHNlLFxuICAgICAgICBjb21tYW5kSW5kZXg6IGlkeCxcbiAgICAgICAgcGF0aDogbS5zcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgc291cmNlS2V5OiBudWxsXG4gICAgICB9O1xuICAgICAgaWYgKHRvdWNoICE9PSBudWxsICYmIHRvdWNoLmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdjcmVhdGUtb3ZlcndyaXRlJyAmJiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gcmVhZFBhdGhzW3JlYWRDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmVhZEN1cnNvciArPSAxO1xuICAgICAgICAgICAgLy8gYGluc3RhbGwgLXNgL2AtLXN0cmlwYCBpcyBkZWxpYmVyYXRlbHkgbmV2ZXIgcGFpcmVkOiBzdHJpcHBlZFxuICAgICAgICAgICAgLy8gb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICAgICAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5IChwbGFuIFx1MDBBNzMgc3RlcCAxYikuXG4gICAgICAgICAgICBpZiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJykge1xuICAgICAgICAgICAgICB0b3VjaC5zb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgICAgICBlbnRyeS5zb3VyY2VLZXkgPSBzb3VyY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZW5hbWUtY29weScpIHtcbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBkZWxldGVQYXRoc1tkZWxldGVDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlQ3Vyc29yICs9IDE7XG4gICAgICAgICAgICB0b3VjaC5yZW5hbWVTb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZW50cnkub3V0Y29tZSA9IGV2YWxTcGFuR2F0ZShtLCB0b3VjaCwgcHJvYmVDYWNoZSk7XG4gICAgICBsaXN0LnB1c2goZW50cnkpO1xuICAgIH1cbiAgICBldmFscy5zZXQoaWR4LCBsaXN0KTtcbiAgfVxuXG4gIC8vIFRoZSBleHBsYW5hdGlvbiBtYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiB0aGUgaGlnaGVzdCBzaW1wbGVDb21tYW5kSW5kZXggd2l0aFxuICAvLyBhIGRlY2lzaXZlUGFzcyBvbiBlYWNoIHBhdGguXG4gIGNvbnN0IHBhc3NCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZhbHMuZ2V0KGlkeCkhKSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykge1xuICAgICAgICBjb25zdCBwcmV2ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSBwYXNzQnlQYXRoLnNldChlLnBhdGgsIGlkeCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUmVzb2x2ZSB0aGUgYWJzZW50LXNvdXJjZSBob2xkcyBhZ2FpbnN0IHRoZSBub3ctY29tcGxldGUgbWFwLCBhbmRcbiAgLy8gZG93bmdyYWRlIGV4cGxhaW5lZCBmYWlsczogYSBkZWNpc2l2ZUZhaWwgb24gYSBwYXRoIGEgbGF0ZXIgY29tbWFuZFxuICAvLyBkZW1vbnN0cmFibHkgcmV3cm90ZSBvciBkZWxldGVkIGlzIHRoZSBvdmVyd3JpdGUsIG5vdCB0aGUgZWFybGllciBjb21tYW5kXG4gIC8vIGZhaWxpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZhbHMuZ2V0KGlkeCkhKSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAncGVuZGluZycpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IGUuc291cmNlS2V5ICE9PSBudWxsID8gcGFzc0J5UGF0aC5nZXQoZS5zb3VyY2VLZXkpIDogdW5kZWZpbmVkO1xuICAgICAgICBlLm91dGNvbWUgPSBwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH0gZWxzZSBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXgpIGUuZXhwbGFpbmVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBQZXItY29tbWFuZCB2ZXJkaWN0czogJ2ZhaWxlZCcgb24gYW55IHVuZXhwbGFpbmVkIGRlY2lzaXZlRmFpbCwgZWxzZVxuICAvLyAnc3VjY2VlZGVkJyBvbiBhdCBsZWFzdCBvbmUgZGVjaXNpdmUgb3V0Y29tZSwgZWxzZSAndW5rbm93bicuXG4gIGNvbnN0IGNvbXB1dGVkID0gbmV3IE1hcDxudW1iZXIsIFZlcmRpY3Q+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGxldCBmYWlsZWQgPSBmYWxzZTtcbiAgICBsZXQgcGFzc2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2YWxzLmdldChpZHgpISkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgJiYgIWUuZXhwbGFpbmVkKSBmYWlsZWQgPSB0cnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHBhc3NlZCA9IHRydWU7XG4gICAgfVxuICAgIGNvbXB1dGVkLnNldChpZHgsIGZhaWxlZCA/ICdmYWlsZWQnIDogcGFzc2VkID8gJ3N1Y2NlZWRlZCcgOiAndW5rbm93bicpO1xuICB9XG5cbiAgLy8gVGhlIGpvaW4gZmlsdGVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYSBza2lwcGVkIGNvbW1hbmQncyBjaGFpbmVkIHZlcmRpY3QgaXNcbiAgLy8gdGhlIGd1YXJkIHRoYXQgc2tpcHBlZCBpdCBcdTIwMTQgJ2ZhaWxlZCcgYWZ0ZXIgYW4gJiYtc2tpcCwgJ3N1Y2NlZWRlZCcgYWZ0ZXJcbiAgLy8gYW4gfHwtc2tpcCBcdTIwMTQgbWF0Y2hpbmcgdGhlIHNoZWxsIHNob3J0LWNpcmN1aXQgKGEgfHwgYiB8fCBjIHN0b3BzIGFmdGVyXG4gIC8vIHRoZSBmaXJzdCBzdWNjZXNzKS4gJ3Vua25vd24nIGZhaWxzIG9wZW4uXG4gIGNvbnN0IGVmZmVjdGl2ZSA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBjb25zdCBza2lwcGVkID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGxldCBwcmV2SW5kZXg6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBqb2luID0gam9pbk9mQ29tbWFuZChncm91cHMuZ2V0KGlkeCkhKTtcbiAgICBjb25zdCBwcmV2VmVyZGljdCA9IHByZXZJbmRleCAhPT0gbnVsbCA/IGVmZmVjdGl2ZS5nZXQocHJldkluZGV4KSA6IHVuZGVmaW5lZDtcbiAgICBpZiAocHJldlZlcmRpY3QgIT09IHVuZGVmaW5lZCAmJiBqb2luICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICgoam9pbiA9PT0gJyYmJyAmJiBwcmV2VmVyZGljdCA9PT0gJ2ZhaWxlZCcpIHx8IChqb2luID09PSAnfHwnICYmIHByZXZWZXJkaWN0ID09PSAnc3VjY2VlZGVkJykpIHtcbiAgICAgICAgZWZmZWN0aXZlLnNldChpZHgsIGpvaW4gPT09ICcmJicgPyAnZmFpbGVkJyA6ICdzdWNjZWVkZWQnKTtcbiAgICAgICAgc2tpcHBlZC5hZGQoaWR4KTtcbiAgICAgICAgcHJldkluZGV4ID0gaWR4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWZmZWN0aXZlLnNldChpZHgsIGNvbXB1dGVkLmdldChpZHgpISk7XG4gICAgcHJldkluZGV4ID0gaWR4O1xuICB9XG5cbiAgLy8gUGFzcyBCOiBydW4gdGhlIHRvdWNoIGhvb2sgZm9yIHN1cnZpdmluZyBzcGFucyBvbmx5IFx1MjAxNCBkZWNpc2l2ZVBhc3MsIG9yXG4gIC8vIGluY29uY2x1c2l2ZSB3aXRoIGFuICdleGlzdHMnIHRhcmdldCAodGhlIGFkdmlzb3J5IHJlc2lkdWFsIGNsYXNzOlxuICAvLyBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgZmlyZSBhbmQgaGVhbC9zdXJmYWNlOyBwaGFudG9tIGRlbGV0ZXMgbmV2ZXJcbiAgLy8gZmlyZSkuIEV4cGxhaW5lZCBmYWlscyBhbmQgZGVjaXNpdmUgZmFpbHMgbmV2ZXIgcmVhY2ggYW4gZXhlY3V0b3IuXG4gIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgaWYgKHNraXBwZWQuaGFzKGlkeCkpIGNvbnRpbnVlO1xuICAgIGxldCB0b3VjaGVzID0gMDtcbiAgICBmb3IgKGNvbnN0IGUgb2YgZXZhbHMuZ2V0KGlkeCkhKSB7XG4gICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLmV4cGxhaW5lZCkgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZS50b3VjaC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKHRvdWNoZXMgPj0gMzIpIHtcbiAgICAgICAgLy8gSGFyZCBwZXItY29tbWFuZCB2b2x1bWUgY2FwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZHJvcCB0aGUgc3VycGx1cyB3aXRoXG4gICAgICAgIC8vIGEgd2FybmluZyByYXRoZXIgdGhhbiBibG93IHRoZSBob29rIHRpbWVvdXQgb24gYSA1MC1jb3B5IGNoYWluLlxuICAgICAgICB3YXJuKGBCYXNoIHRvdWNoIGNhcCAoMzIpIHJlYWNoZWQgZm9yIHNpbXBsZSBjb21tYW5kICR7aWR4fTsgZHJvcHBpbmcgdGhlIHJlbWFpbmluZyB0b3VjaGVzYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdG91Y2hlcyArPSAxO1xuICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKGUudG91Y2gsIGV4ZWN1dG9ycywgbWVtbywgcHJvYmVDYWNoZSk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuIiwgIi8qKlxuICogU3RhdGljIGNsYXNzaWZpY2F0aW9uIG9mIGEgQmFzaCB0b29sIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZVxuICogcGF0aChzKSArIGxpbmUgcmFuZ2UocykgaXQgcmVhZHMgb3Igd3JpdGVzLCB3aGVyZSB0aGF0J3Mgc3RhdGljYWxseVxuICogZGV0ZXJtaW5hYmxlLiBCdWlsdCBmcm9tIGFuIGVtcGlyaWNhbCBwYXNzIG92ZXIgfjMxayByZWFsIENsYXVkZSBDb2RlXG4gKiBCYXNoIGludm9jYXRpb25zIChzZWUgYW5hbHl6ZS10cmFuc2NyaXB0cy5tdHMpIFx1MjAxNCB0aGUgaWRpb21zIGJlbG93IGFyZVxuICogZXhhY3RseSB0aGUgb25lcyB0aGF0IHR1cm5lZCBvdXQgdG8gYmUgY29tbW9uIEFORCByZWxpYWJsZSB0aGVyZS5cbiAqXG4gKiBEZWxpYmVyYXRlbHkgTk9UIGNvdmVyZWQgKHNlZSB0aGUgcmVzZWFyY2ggcmVwb3J0KTogYXdrIE5SLXRyaWNrcyAocmFyZSxcbiAqIHVuY29uc3RyYWluZWQgc3ludGF4KSwgZ3JlcCAtbi8tQS8tQi8tQyAodGhlIHdpbmRvdyBpcyBhbmNob3JlZCB0byBtYXRjaFxuICogcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50LCBub3QgaW4gdGhlIGNvbW1hbmQgdGV4dCksIGFuZCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKS5cbiAqXG4gKiBUaGUgY2FyZCdzIHdyaXRlLXRvdWNoIGZhbWlsaWVzIFx1MjAxNCByZWRpcmVjdGlvbnMgYW5kIGhlcmVkb2NzIChcdTAwQTc1LjFcdTIwMTNcdTAwQTc1LjIpLFxuICogY3AgYW5kIGluc3RhbGwgKFx1MDBBNzUuMyksIG12IGFuZCBnaXQgbXYgKFx1MDBBNzUuNCksIHJtIGFuZCB0cnVuY2F0ZSAoXHUwMEE3NS41KSxcbiAqIHNlZCAtaSAoXHUwMEE3NS42KSwgcGF0Y2ggYW5kIGdpdCBhcHBseSAoXHUwMEE3NS43KSwgZm9ybWF0dGVyIHdyaXRlIGZsYWdzIChcdTAwQTc1LjgpLFxuICogYW5kIGdpdCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjcyAoXHUwMEE3NS45KSBcdTIwMTQgYXJlIHRoZSBncmFtbWFycyBiZWxvdy4gRWFjaFxuICogZmFtaWx5IGZhaWxzIGNsb3NlZCBvbiB3aGF0IGl0IGNhbm5vdCBzdGF0aWNhbGx5IGF0dHJpYnV0ZTpcbiAqIHNoZWxsLWV4cGFuZGVkIG9yIGR5bmFtaWMgY29udGVudCwgcmVjdXJzaXZlIHJlbW92YWwgKGBybSAtcmApLFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCksIGRpcmVjdG9yeS1zaGFwZWQgdGFyZ2V0cywgd3JhcHBlci13cmFwcGVkIGNvbW1hbmRzXG4gKiB3aG9zZSBhcmd2IGNhbm5vdCBiZSByZWNvdmVyZWQsIGFuZCB1bm1hdGNoZWQgcGF0aHNwZWNzIGVtaXQgbm8gc3BhbiBhdFxuICogYWxsIG9yIGFuIGV4cGxpY2l0IHVucmVzb2x2ZWQgZW50cnkgXHUyMDE0IG5ldmVyIGEgZ3Vlc3NlZCB3cml0ZS5cbiAqL1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gYXMgam9pblBhdGgsIHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMsIGNvdW50R2l0QmxvYkxpbmVzIH0gZnJvbSAnLi9jb21tYW5kLXJlc29sdmUuanMnO1xuaW1wb3J0IHsgdHlwZSBTaW1wbGVDb21tYW5kLCBzcGxpdFRvcExldmVsLCBzdHJpcExlYWRpbmdBc3NpZ25tZW50cywgdHlwZSBUb2tlbiwgdG9rZW5pemUgfSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IHR5cGUgUGF0aFN0cmlwLCBwYXJzZVVuaWZpZWREaWZmUmFuZ2UgfSBmcm9tICcuL3VuaWZpZWQtZGlmZi5qcyc7XG5cbi8qKlxuICogVGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBraW5kIG9mIGEgcmVzb2x2ZWQgc3Bhbi4gVGhlIGFkYXB0ZXJzIHRyYW5zbGF0ZSBmcm9tXG4gKiB0aGlzLCBuZXZlciBmcm9tIGBpZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnYC1zdHlsZSBjaGVja3MgKHBsYW4gXHUwMEE3MSkuXG4gKi9cbmV4cG9ydCB0eXBlIE9wZXJhdGlvbiA9XG4gIHwgJ3JlYWQnIC8vIHJlYWQgaWRpb21zOyBjcC9pbnN0YWxsIHNvdXJjZSBvcGVyYW5kc1xuICB8ICdjcmVhdGUtb3ZlcndyaXRlJyAvLyB0cnVuY2F0aW5nIGNvbnRlbnQgd3JpdGVzOiA+IHJlZGlyZWN0cywgdGVlLCBoZXJlZG9jID4sIGNwL212IGRlc3QsIHJlc3RvcmUvY2hlY2tvdXQsIHBhdGNoIGFkZFxuICB8ICdhcHBlbmQnIC8vID4+IHJlZGlyZWN0cywgdGVlIC1hLCBoZXJlZG9jID4+XG4gIHwgJ21vZGlmeScgLy8gaW4tcGxhY2UgZWRpdHMgd2l0aCB1bmtub3duIGNvbnRlbnQ6IHNlZCAtaSwgcGF0Y2ggaHVua3MsIGZvcm1hdHRlciB3cml0ZSBmbGFnc1xuICB8ICdyZW5hbWUtY29weScgLy8gbXYvZ2l0IG12L3BhdGNoLXJlbmFtZSBkZXN0aW5hdGlvbiAod2hvbGUtZmlsZSB3cml0ZSwgc2FtZSB0b3VjaCBhcyBjcmVhdGUtb3ZlcndyaXRlKVxuICB8ICd0cnVuY2F0ZScgLy8gOiA+IGYsIGJhcmUgPiBmLCB0cnVuY2F0ZVxuICB8ICdkZWxldGUnOyAvLyBybSwgbXYvZ2l0IG12IHNvdXJjZSwgcGF0Y2ggZGVsZXRlXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRTcGFuIHtcbiAgb3BlcmF0aW9uOiBPcGVyYXRpb247XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogRXhhY3QgcmFuZ2U6IGV2ZXJ5IHJlYWQ7IG1vZGlmeSBvcGVyYXRpb25zIHdpdGggYSBzdGF0aWNhbGx5IGtub3duIHJhbmdlXG4gICAqIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsIHBhdGNoIGh1bmsgdW5pb25zKS4gQWJzZW50IGZvciB3cml0ZXMgXHUyMTkyXG4gICAqIHdob2xlLWZpbGUgc2NvcGUuXG4gICAqL1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTdGF0aWNhbGx5IGtub3duIHdyaXR0ZW4gY29udGVudCBcdTIwMTQgYXBwZW5kIGJvZGllcyBhbmQgbGl0ZXJhbCBvdmVyd3JpdGVcbiAgICogYm9kaWVzIChoZXJlZG9jL2VjaG8vcHJpbnRmL3RlZSBsaXRlcmFscywgcGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBPbiBhcHBlbmRzIGl0XG4gICAqIGlzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHk7IG9uIGBjcmVhdGUtb3ZlcndyaXRlYCBpdCBpcyB0aGUgZXhhY3QgZ2F0ZSdzXG4gICAqIHBvc3QtY29udGVudCBcdTIwMTQgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChgd3JpdHRlbjogJydgKSBlaXRoZXJcbiAgICogd2F5LlxuICAgKi9cbiAgd3JpdHRlbj86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXMgTmAgc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiB0aGVcbiAgICogXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IChgLXMgMGAgXHUyMTkyIHRoZSBlbXB0eSBnYXRlKS5cbiAgICogQWJzZW50IGZvciByZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSwgYC1yIHJlZmAsIGFuZCBldmVyeSBvdGhlclxuICAgKiBvcGVyYXRpb24gXHUyMDE0IHRob3NlIGdhdGUgZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzaXplPzogbnVtYmVyO1xuICAvKipcbiAgICogT3JkaW5hbCBvZiB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kIHdpdGhpbiB0aGUgY29tcG91bmQsIGluIHdhbGtlclxuICAgKiBvcmRlcjsgZ3JvdXBzIHRoZSBzcGFucyBvZiBvbmUgY29tbWFuZCBmb3Igam9pbiBnYXRpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICAgKi9cbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQ7IG9ubHkgYCcmJidgL2AnfHwnYCBnYXRlLlxuICAgKiBBYnNlbnQgZm9yIGBzdGFydGAvYDtgL25ld2xpbmUvYCZgL2B8YCBib3VuZGFyaWVzLlxuICAgKi9cbiAgam9pbj86ICcmJicgfCAnfHwnO1xuICBub3RlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnXG4gIC8vIFRoZSB3cml0ZS10b3VjaCBmYW1pbGllcyAocGxhbiBcdTAwQTc1KS4gSWRpb20gc3RheXMgbWF0Y2ggbWV0YWRhdGEgZm9yIHRlc3RzXG4gIC8vIGFuZCB1bnJlc29sdmVkIHJlYXNvbnM7IGFkYXB0ZXIgYmVoYXZpb3Iga2V5cyBvbiBgb3BlcmF0aW9uYCwgbmV2ZXIgaWRpb20uXG4gIHwgJ3JlZGlyZWN0LXdyaXRlJyAvLyBcdTAwQTc1LjE6IGVjaG8vcHJpbnRmL3RlZSBjb250ZW50IHJlZGlyZWN0c1xuICB8ICd0cnVuY2F0ZS13cml0ZScgLy8gXHUwMEE3NS4xOiBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0aW9uc1xuICB8ICdjcC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ2luc3RhbGwtd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdtdi13cml0ZScgLy8gXHUwMEE3NS40OiBtdiBhbmQgZ2l0IG12XG4gIHwgJ3JtLXdyaXRlJyAvLyBcdTAwQTc1LjU6IHJtIGFuZCBnaXQgcm1cbiAgfCAndHJ1bmNhdGUtY29tbWFuZCcgLy8gXHUwMEE3NS41OiB0aGUgdHJ1bmNhdGUgY29tbWFuZFxuICB8ICdzZWQtaW5wbGFjZScgLy8gXHUwMEE3NS42OiBzZWQgLWlcbiAgfCAncGF0Y2gtd3JpdGUnIC8vIFx1MDBBNzUuNzogcGF0Y2ggYW5kIGdpdCBhcHBseVxuICB8ICdmb3JtYXR0ZXItd3JpdGUnIC8vIFx1MDBBNzUuOFxuICB8ICdnaXQtcmVzdG9yZS13cml0ZScgLy8gXHUwMEE3NS45OiBnaXQgcmVzdG9yZSBwYXRoc3BlY3NcbiAgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJzsgLy8gXHUwMEE3NS45OiBnaXQgY2hlY2tvdXQgLS0gcGF0aHNwZWNzXG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSGVhZFRhaWxGbGFncyhyZXN0OiBzdHJpbmdbXSk6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICdoZWFkLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCcsIGVuZDogbiB9IGFzIExpbmVSYW5nZVNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hUYWlsKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAndGFpbCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSBmcm9tU3RhcnQgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiBuIH0gOiB7IGtpbmQ6ICdsYXN0TkxpbmVzJywgY291bnQ6IG4gfTtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICd0YWlsLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChcbiAgcmVzdDogc3RyaW5nW11cbik6IHsgc3ViSWR4OiBudW1iZXI7IHN1YmNvbW1hbmQ6IHN0cmluZzsgY0Rpcjogc3RyaW5nIHwgbnVsbDsgY0RpclVucmVzb2x2YWJsZTogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGxldCBjRGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGNEaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHJlc3QubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBjRGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgY0RpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWJJZHg6IGksIHN1YmNvbW1hbmQ6IGEsIGNEaXIsIGNEaXJVbnJlc29sdmFibGUgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuY29uc3QgUkVWX1BBVEggPSAvXihbXlxcczpdKyk6KC4rKSQvO1xuXG5mdW5jdGlvbiBtYXRjaEdpdFNob3coYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ3Nob3cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndlxuICAgIC5zbGljZSgxKVxuICAgIC5zbGljZShzdWIuc3ViSWR4ICsgMSlcbiAgICAuZmlsdGVyKChhKSA9PiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBjb25zdCByZXZQYXRoQXJnID0gYWZ0ZXIuZmluZCgoYSkgPT4gUkVWX1BBVEgudGVzdChhKSk7XG4gIGlmICghcmV2UGF0aEFyZykgcmV0dXJuIFtdO1xuICBjb25zdCBtID0gcmV2UGF0aEFyZy5tYXRjaChSRVZfUEFUSCk7XG4gIGlmICghbSkgcmV0dXJuIFtdO1xuICBjb25zdCBbLCByZXYsIHBhdGhdID0gbTtcbiAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHJldikpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IG9yIHJldmlzaW9uIGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnLCByZXYgfSxcbiAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICB9XG4gIF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoR2l0TG9nTChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnbG9nJykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3Yuc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFmdGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFmdGVyW2ldO1xuICAgIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy1MJykgc3BlYyA9IGFmdGVyW2kgKyAxXSA/PyBudWxsO1xuICAgIGVsc2UgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgaWYgKCFzcGVjKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gc3BlYy5tYXRjaCgvXihcXGQrKSwoXFxkKyk6KC4rKSQvKTtcbiAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHMsIGUsIHBhdGhdID0gbTtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgICB9XG4gICAgICBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IE51bWJlci5wYXJzZUludChzLCAxMCksIGVuZDogTnVtYmVyLnBhcnNlSW50KGUsIDEwKSB9LFxuICAgICAgICByZXNvbHZlcktpbmQ6ICdmcycsXG4gICAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZXJlZG9jIHdyaXRlcyAocGxhbiBcdTAwQTc1LjIpOiBoYW5kbGVkIGFzIGEgZGVkaWNhdGVkIHJhdy10ZXh0IHBhc3MgYmVjYXVzZSB0aGVcbi8vIGJvZHkgY2FuIGl0c2VsZiBjb250YWluICYmLzsvfC9uZXdsaW5lcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBjb25mdXNlXG4vLyBzcGxpdFRvcExldmVsLiBUaGUgb3BlbmVyIHNjYW5uZXIgaXMgcXVvdGUtYXdhcmUgYW5kIHZhbGlkYXRlcyB0aGUgY2xvc2luZ1xuLy8gZGVsaW1pdGVyOyBtYXRjaGVkIGhlcmVkb2NzIGFyZSBtYXNrZWQgb3V0IG9mIHRoZSBzdHJpbmcgKHJlcGxhY2VkIHdpdGggYW5cbi8vIGluZGV4ZWQgcGxhY2Vob2xkZXIgc2ltcGxlLWNvbW1hbmQpIGJlZm9yZSB0aGUgcmVzdCBvZiB0aGUgcGlwZWxpbmUgcnVucyxcbi8vIGFuZCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgbWFpbiB3YWxrIHNvIHRoZSB3cml0ZSBpcyByZXNvbHZlZFxuLy8gYWdhaW5zdCB0aGUgY29ycmVjdCBgY2RgLXRyYWNrZWQgZGlyZWN0b3J5LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgaGVyZWRvYydzIGNvbnRlbnQtY2FycnlpbmcgZmFjdHMsIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSB3YWxrLiAqL1xuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIC8qKiBUaGUgb3BlbmVyIGxpbmUgdmVyYmF0aW0gKGUuZy4gYGNhdCA+IGYgPDwnRU9GJ2ApLCByZS10b2tlbml6ZWQgZHVyaW5nIHRoZSB3YWxrLiAqL1xuICBvcGVuZXI6IHN0cmluZztcbiAgLyoqIFRoZSBoZXJlZG9jIGJvZHk7IGA8PC1gIGJvZGllcyBoYXZlIGxlYWRpbmcgdGFicyBzdHJpcHBlZCBwZXIgbGluZS4gKi9cbiAgYm9keTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgSGVyZWRvY09wZW5lciB7XG4gIC8qKiBXaGVyZSB0aGUgaGVyZWRvYydzIHNpbXBsZSBjb21tYW5kIHN0YXJ0cyBpbiB0aGUgcmF3IHN0cmluZy4gKi9cbiAgY21kU3RhcnQ6IG51bWJlcjtcbiAgLyoqIFRoZSBuZXdsaW5lIGVuZGluZyB0aGUgb3BlbmVyIGxpbmUsIG9yIHJhdy5sZW5ndGggd2hlbiBpdCdzIHRoZSBsYXN0IGxpbmUuICovXG4gIG9wZW5lckxpbmVFbmQ6IG51bWJlcjtcbiAgLyoqIFRoZSBjbG9zaW5nIGRlbGltaXRlciAocXVvdGVzIHN0cmlwcGVkKS4gKi9cbiAgZGVsaW06IHN0cmluZztcbiAgLyoqIGA8PC1gOiBzdHJpcCBsZWFkaW5nIHRhYnMgZnJvbSB0aGUgYm9keSBhbmQgdGhlIGNsb3NlciBsaW5lLiAqL1xuICB0YWJTdHJpcDogYm9vbGVhbjtcbn1cblxuY29uc3QgQkFSRV9ERUxJTSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKiQvO1xuXG4vKipcbiAqIEZpbmQgdGhlIG5leHQgaGVyZWRvYyBvcGVuZXIgKGA8PGAvYDw8LWApIGF0IHRvcCBsZXZlbCwgc2Nhbm5pbmcgZnJvbVxuICogYGZyb21gLiBNaXJyb3JzIHNwbGl0VG9wTGV2ZWwncyBzZXBhcmF0b3IgaGFuZGxpbmcgc28gYGNtZFN0YXJ0YCBtYXJrcyB0aGVcbiAqIG9wZW5lcidzIG93biBzaW1wbGUgY29tbWFuZDogdG9wLWxldmVsIGAmJmAvYHx8YC9gO2AvbmV3bGluZS9gJmAgc3RhcnQgYSBuZXdcbiAqIGNvbW1hbmQgKGEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiksIGA+YC1yZWRpcmVjdHMsIGR1cFxuICogcmVkaXJlY3RzIChgMj4mMWApIGFuZCBwYXJlbiBuZXN0aW5nIHN0YXkgaW5zaWRlIHRoZSBjb21tYW5kLCBhbmRcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApIGFyZSBvdXQgb2Ygc2NvcGUuIEFuIElPX05VTUJFUiBmZCBkaXJlY3RseSBiZWZvcmUgdGhlXG4gKiBvcGVyYXRvciAoYDI8PEVPRmApIHJlZGlyZWN0cyB0aGF0IGZkLCBub3Qgc3RkaW4gXHUyMDE0IG5vdCBhIGhlcmVkb2MuIFJldHVybnNcbiAqIG51bGwgd2hlbiBubyBvcGVuZXIgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGZpbmRIZXJlZG9jT3BlbmVyKHJhdzogc3RyaW5nLCBmcm9tOiBudW1iZXIpOiBIZXJlZG9jT3BlbmVyIHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBjbWRTdGFydCA9IGZyb207XG4gIGxldCBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICBsZXQgaSA9IGZyb207XG5cbiAgLyoqIFJlYWQgb25lIGRlbGltaXRlciB3b3JkIHN0YXJ0aW5nIGF0IGBzdGFydGAgKHRoZSBhdHRhY2hlZCB0YWlsIG9mIGA8PEVPRmAvYDw8J0VPRidgLCBvciBhIHN0YW5kYWxvbmUgbmV4dCB3b3JkKS4gUXVvdGVzIGNvbnRyaWJ1dGUgdGhlaXIgY29udGVudDsgYSBiYWNrc2xhc2ggZXNjYXBlcyB0aGUgbmV4dCBjaGFyLiBSZXR1cm5zIG51bGwgb24gYW4gdW5iYWxhbmNlZCBxdW90ZSAoZmFpbCBjbG9zZWQpLiAqL1xuICBjb25zdCByZWFkRGVsaW1Xb3JkID0gKHN0YXJ0OiBudW1iZXIpOiB7IGRlbGltOiBzdHJpbmc7IHNhd1F1b3RlOiBib29sZWFuOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBkID0gJyc7XG4gICAgbGV0IHNhd1F1b3RlID0gZmFsc2U7XG4gICAgbGV0IGsgPSBzdGFydDtcbiAgICB3aGlsZSAoayA8IG4gJiYgIS9cXHMvLnRlc3QocmF3W2tdKSAmJiByYXdba10gIT09ICc8JyAmJiByYXdba10gIT09ICc+Jykge1xuICAgICAgY29uc3QgYyA9IHJhd1trXTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgICAgbGV0IG0gPSBrICsgMTtcbiAgICAgICAgd2hpbGUgKG0gPCBuICYmIHJhd1ttXSAhPT0gcXVvdGUpIHtcbiAgICAgICAgICBkICs9IHJhd1ttXTtcbiAgICAgICAgICBtICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG0gPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICAgIHNhd1F1b3RlID0gdHJ1ZTtcbiAgICAgICAgayA9IG0gKyAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgayArIDEgPCBuKSB7XG4gICAgICAgIGQgKz0gcmF3W2sgKyAxXTtcbiAgICAgICAgayArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGQgKz0gYztcbiAgICAgIGsgKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGVsaW06IGQsIHNhd1F1b3RlLCBuZXh0OiBrIH07XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHJhd1tpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID4gMCkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnJiYnLCBpKSB8fCByYXcuc3RhcnRzV2l0aCgnfHwnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMjtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCd8JicsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAvLyBBIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24gKG1pcnJvcmluZ1xuICAgICAgLy8gc3BsaXRUb3BMZXZlbCk7IGFueXRoaW5nIGVsc2Ugc3RhcnRzIGEgbmV3IHNpbXBsZSBjb21tYW5kLlxuICAgICAgaWYgKCFwZW5kaW5nUGlwZSkgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIGFuZCBkdXAgcmVkaXJlY3RzIChgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdFxuICAgICAgLy8gY29tbWFuZCBzZXBhcmF0b3JzIChtaXJyb3Jpbmcgc3BsaXRUb3BMZXZlbCkuXG4gICAgICBjb25zdCB0cmltbWVkID0gcmF3LnNsaWNlKGNtZFN0YXJ0LCBpKS50cmltRW5kKCk7XG4gICAgICBjb25zdCBkdXBSZWRpcmVjdCA9XG4gICAgICAgIHRyaW1tZWQuZW5kc1dpdGgoJz4nKSAmJiAodHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QodHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdID8/ICcnKSk7XG4gICAgICBpZiAocmF3W2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnICYmIHJhd1tpICsgMV0gPT09ICc8Jykge1xuICAgICAgLy8gYDw8PGAgaXMgYSBoZXJlLXN0cmluZyAob3V0IG9mIHNjb3BlKTsgYDw8LWAgc3RyaXBzIGxlYWRpbmcgdGFicy5cbiAgICAgIGlmIChyYXdbaSArIDJdID09PSAnPCcpIHtcbiAgICAgICAgaSArPSAzO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGxldCBqID0gaSAtIDE7XG4gICAgICB3aGlsZSAoaiA+PSBmcm9tICYmIC9cXGQvLnRlc3QocmF3W2pdKSkgaiAtPSAxO1xuICAgICAgY29uc3QgaW9OdW1iZXIgPSBqIDwgaSAtIDEgJiYgKGogPCBmcm9tIHx8IC9cXHN8Wzt8JihdLy50ZXN0KHJhd1tqXSkpO1xuICAgICAgaWYgKGlvTnVtYmVyKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB0YWJTdHJpcCA9IHJhd1tpICsgMl0gPT09ICctJztcbiAgICAgIGNvbnN0IG9wTGVuID0gdGFiU3RyaXAgPyAzIDogMjtcbiAgICAgIGNvbnN0IGxpbmVFbmQgPSByYXcuaW5kZXhPZignXFxuJywgaSk7XG4gICAgICBjb25zdCBvcGVuZXJMaW5lRW5kID0gbGluZUVuZCA9PT0gLTEgPyBuIDogbGluZUVuZDtcbiAgICAgIGNvbnN0IGF0dGFjaGVkID0gcmVhZERlbGltV29yZChpICsgb3BMZW4pO1xuICAgICAgbGV0IGRlbGltID0gYXR0YWNoZWQgPT09IG51bGwgPyAnJyA6IGF0dGFjaGVkLmRlbGltO1xuICAgICAgbGV0IHNhd1F1b3RlID0gYXR0YWNoZWQgPT09IG51bGwgPyBmYWxzZSA6IGF0dGFjaGVkLnNhd1F1b3RlO1xuICAgICAgaWYgKGRlbGltID09PSAnJyAmJiBhdHRhY2hlZCAhPT0gbnVsbCkge1xuICAgICAgICAvLyBTdGFuZGFsb25lIG9wZXJhdG9yOiB0aGUgZGVsaW1pdGVyIGlzIHRoZSBuZXh0IHdvcmQuXG4gICAgICAgIGxldCBrID0gYXR0YWNoZWQubmV4dDtcbiAgICAgICAgd2hpbGUgKGsgPCBvcGVuZXJMaW5lRW5kICYmIC9cXHMvLnRlc3QocmF3W2tdKSkgayArPSAxO1xuICAgICAgICBjb25zdCB3b3JkID0gcmVhZERlbGltV29yZChrKTtcbiAgICAgICAgaWYgKHdvcmQgPT09IG51bGwpIGRlbGltID0gJyc7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGRlbGltID0gd29yZC5kZWxpbTtcbiAgICAgICAgICBzYXdRdW90ZSA9IHdvcmQuc2F3UXVvdGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChkZWxpbSA9PT0gJycgfHwgKCFzYXdRdW90ZSAmJiAhQkFSRV9ERUxJTS50ZXN0KGRlbGltKSkpIHtcbiAgICAgICAgLy8gTm8gZGVsaW1pdGVyLCBvciBhIGJhcmUgZm9ybSBvdXRzaWRlIHRoZSBpZGVudGlmaWVyIHNoYXBlIFx1MjAxNCBmYWlsXG4gICAgICAgIC8vIGNsb3NlZCBhbmQga2VlcCBzY2FubmluZyBwYXN0IHRoZSBvcGVyYXRvci5cbiAgICAgICAgaSArPSBvcExlbjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBjbWRTdGFydCwgb3BlbmVyTGluZUVuZCwgZGVsaW0sIHRhYlN0cmlwIH07XG4gICAgfVxuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgYm9keSBvZiBhbiBvcGVuZXIgcnVucyBmcm9tIGFmdGVyIHRoZSBvcGVuZXIgbGluZSdzIG5ld2xpbmUgdG8gdGhlIGxpbmVcbiAqIHRoYXQgaXMgZXhhY3RseSB0aGUgZGVsaW1pdGVyIChgPDxgKSwgb3IgaXRzIGxlYWRpbmctdGFiLXN0cmlwcGVkIGZvcm1cbiAqIChgPDwtYCksIHRyYWlsaW5nIHdoaXRlc3BhY2UgYWxsb3dlZC4gUmV0dXJucyB0aGUgY2xvc2VyJ3MgbGluZSBib3VuZHMsIG9yXG4gKiBudWxsIHdoZW4gbm8gY2xvc2VyIGV4aXN0cyAoZmFpbCBjbG9zZWQpLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQ2xvc2VyKHJhdzogc3RyaW5nLCBvcGVuOiBIZXJlZG9jT3BlbmVyKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IG4gPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogbjtcbiAgbGV0IGxpbmVQb3MgPSBib2R5U3RhcnQ7XG4gIHdoaWxlIChsaW5lUG9zIDwgbikge1xuICAgIGNvbnN0IG5sID0gcmF3LmluZGV4T2YoJ1xcbicsIGxpbmVQb3MpO1xuICAgIGNvbnN0IGxpbmVFbmQgPSBubCA9PT0gLTEgPyBuIDogbmw7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gb3Blbi50YWJTdHJpcCA/IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKS5yZXBsYWNlKC9eXFx0Ky8sICcnKSA6IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKTtcbiAgICBpZiAoXG4gICAgICBjYW5kaWRhdGUgPT09IG9wZW4uZGVsaW0gfHxcbiAgICAgIChjYW5kaWRhdGUuc3RhcnRzV2l0aChvcGVuLmRlbGltKSAmJiAvXlsgXFx0XSokLy50ZXN0KGNhbmRpZGF0ZS5zbGljZShvcGVuLmRlbGltLmxlbmd0aCkpKVxuICAgICkge1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBsaW5lUG9zLCBsaW5lRW5kIH07XG4gICAgfVxuICAgIGlmIChubCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGxpbmVQb3MgPSBubCArIDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTWFzayBldmVyeSBoZXJlZG9jIG91dCBvZiB0aGUgcmF3IGNvbW1hbmQgc3RyaW5nLCByZXR1cm5pbmcgdGhlIGJvZGllcyBhbmRcbiAqIG9wZW5lcnMgZm9yIHJlLWFzc29jaWF0aW9uIGJ5IGluZGV4LiBUaGUgbWFzayBjb3ZlcnNcbiAqIGBbY21kU3RhcnQsIGNsb3NlckxpbmVFbmQpYCBcdTIwMTQgdGhlIG9wZW5lciBsaW5lIHRocm91Z2ggdGhlIGNsb3NlciBsaW5lLCB0aGVcbiAqIGNsb3NlcidzIG5ld2xpbmUgZXhjbHVkZWQgXHUyMDE0IHNvIGEgY29tbWFuZCBqb2luZWQgYmVmb3JlIHRoZSBvcGVuZXJcbiAqIChgY21kMSAmJiBjYXQgPDxFT0ZgKSBrZWVwcyBpdHMgc3RydWN0dXJlLCBhbmQgdGhlIHBsYWNlaG9sZGVyIHN0YW5kcyBhbG9uZVxuICogYXMgaXRzIG93biBzaW1wbGUgY29tbWFuZC4gQSBoZXJlZG9jIHdpdGhvdXQgYSBjbG9zZXIgZmFpbHMgY2xvc2VkOiBpdHNcbiAqIG9wZW5lciBsaW5lIHN0YXlzIHVubWFza2VkIGFuZCBzY2FubmluZyByZXN1bWVzIGFmdGVyIGl0LlxuICovXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IG9wZW4gPSBmaW5kSGVyZWRvY09wZW5lcihyYXcsIGN1cnNvcik7XG4gICAgaWYgKG9wZW4gPT09IG51bGwpIGJyZWFrO1xuICAgIGNvbnN0IGNsb3NlID0gaGVyZWRvY0Nsb3NlcihyYXcsIG9wZW4pO1xuICAgIGlmIChjbG9zZSA9PT0gbnVsbCkge1xuICAgICAgY3Vyc29yID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgcmF3Lmxlbmd0aCA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiByYXcubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICBsZXQgYm9keSA9IHJhdy5zbGljZShib2R5U3RhcnQsIGNsb3NlLmxpbmVTdGFydCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICBpZiAob3Blbi50YWJTdHJpcCkgYm9keSA9IGJvZHkucmVwbGFjZSgvXlxcdCsvZ20sICcnKTtcbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbi5jbWRTdGFydCk7XG4gICAgbWFza2VkICs9IGBfX2hlcmVkb2NfJHt3cml0ZXMubGVuZ3RofV9fYDtcbiAgICB3cml0ZXMucHVzaCh7IG9wZW5lcjogcmF3LnNsaWNlKG9wZW4uY21kU3RhcnQsIG9wZW4ub3BlbmVyTGluZUVuZCksIGJvZHkgfSk7XG4gICAgY3Vyc29yID0gY2xvc2UubGluZUVuZDtcbiAgfVxuICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvcik7XG4gIHJldHVybiB7IHdyaXRlcywgbWFza2VkIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVkaXJlY3QtdG9rZW4gYW5hbHlzaXMgYW5kIHRoZSB3cml0ZS10b3VjaCBncmFtbWFycyAocGxhbiBcdTAwQTc1LjEsIFx1MDBBNzUuMikuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJlZGlyZWN0SW5mbyB7XG4gIC8qKiBJT19OVU1CRVIgZmQgKGAxPmAvYDI+YCksIG9yIG51bGwgd2hlbiBpbXBsaWNpdC4gKi9cbiAgZmQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBUaGUgb3BlcmF0b3IuICovXG4gIG9wOiAnPicgfCAnPj4nIHwgJyY+JyB8ICcmPj4nIHwgJz4mJyB8ICc8JyB8ICc8PCcgfCAnPDwtJyB8ICc8PDwnO1xuICAvKiogQXR0YWNoZWQgdGFyZ2V0IHRleHQsIG9yIG51bGwgZm9yIGEgc3RhbmRhbG9uZSBvcGVyYXRvciAodGFyZ2V0ID0gbmV4dCB0b2tlbikuICovXG4gIHRhcmdldDogc3RyaW5nIHwgbnVsbDtcbn1cblxuY29uc3QgUkVESVJFQ1RfVE9LRU4gPSAvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvO1xuXG5mdW5jdGlvbiBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odGV4dDogc3RyaW5nKTogUmVkaXJlY3RJbmZvIHwgbnVsbCB7XG4gIGNvbnN0IG0gPSB0ZXh0Lm1hdGNoKFJFRElSRUNUX1RPS0VOKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCBmZFRleHQsIG9wLCB0YXJnZXRdID0gbTtcbiAgcmV0dXJuIHtcbiAgICBmZDogZmRUZXh0ID09PSAnJyA/IG51bGwgOiBOdW1iZXIucGFyc2VJbnQoZmRUZXh0LCAxMCksXG4gICAgb3A6IG9wIGFzIFJlZGlyZWN0SW5mb1snb3AnXSxcbiAgICB0YXJnZXQ6IHRhcmdldCA9PT0gJycgPyBudWxsIDogdGFyZ2V0XG4gIH07XG59XG5cbi8qKlxuICogQSBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdCAocGxhbiBcdTAwQTc1LjEpOiBmZC0xIGA+YC9gPj5gIChleHBsaWNpdCBgMT5gL2AxPj5gXG4gKiBpbmNsdWRlZCkgYW5kIGAmPmAvYCY+PmAuIEZELW51bWJlcmVkIChgMj5gKSwgZHVwIChgMj4mMWAsIGA+JmZgKSxcbiAqIGAmYC1sZWFkaW5nLXRhcmdldCBkdXAgKGA+JmApIGFuZCBzdGRpbiAoYDxgKSBmb3JtcyBuZXZlciBwcm9kdWNlIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGlzQ29udGVudFJlZGlyZWN0KHI6IFJlZGlyZWN0SW5mbyk6IGJvb2xlYW4ge1xuICBpZiAoci5vcCA9PT0gJz4nIHx8IHIub3AgPT09ICc+PicpIHtcbiAgICBpZiAoci5mZCAhPT0gbnVsbCAmJiByLmZkICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHIudGFyZ2V0Py5zdGFydHNXaXRoKCcmJykpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gci5vcCA9PT0gJyY+JyB8fCByLm9wID09PSAnJj4+Jztcbn1cblxuLyoqIFRoZSBhcmd2IHN0cmVhbSBhbmQgcmVkaXJlY3QgbGlzdCBvZiBhIHNpbXBsZSBjb21tYW5kIChwbGFuIFx1MDBBNzUuMTApOiB3b3JkcyBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kIHRoZWlyIHRhcmdldHMuICovXG5mdW5jdGlvbiBhbmFseXplVG9rZW5zKHRva2VuczogVG9rZW5bXSk6IHsgYXJndjogc3RyaW5nW107IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gfSB7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmZvID0gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRva2VuLnRleHQpO1xuICAgIGlmIChpbmZvID09PSBudWxsKSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluZm8udGFyZ2V0ID09PSBudWxsKSB7XG4gICAgICAvLyBBIHN0YW5kYWxvbmUgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldCAob3JcbiAgICAgIC8vIGhlcmVkb2MgZGVsaW1pdGVyIC8gaGVyZS1zdHJpbmcgY29udGVudCkgXHUyMDE0IGF0dGFjaGVkIHRvIHRoZSByZWRpcmVjdFxuICAgICAgLy8gc28gdGhlIHdyaXRlIGdyYW1tYXJzIHNlZSBpdCwgYW5kIGV4Y2x1ZGVkIGZyb20gYXJndi5cbiAgICAgIGNvbnN0IG5leHQgPSB0b2tlbnNbaSArIDFdO1xuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhbmV4dC5pc1JlZGlyZWN0KSB7XG4gICAgICAgIHJlZGlyZWN0cy5wdXNoKHsgLi4uaW5mbywgdGFyZ2V0OiBuZXh0LnRleHQgfSk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJlZGlyZWN0cy5wdXNoKGluZm8pO1xuICB9XG4gIHJldHVybiB7IGFyZ3YsIHJlZGlyZWN0cyB9O1xufVxuXG4vKipcbiAqIExpdGVyYWwgYGVjaG9gL2BwcmludGZgIGNvbnRlbnQgKHBsYW4gXHUwMEE3NS4xKSBmb3IgYm9keSB0aHJlYWRpbmc6IG5vXG4gKiBmbGFncywgbm8gc2hlbGwgZXhwYW5zaW9uLCBubyBnbG9iczsgYHByaW50ZmAgb25seSB3aGVuIHRoZSBmb3JtYXQgaGFzIG5vXG4gKiBgJWAvYmFja3NsYXNoIGRpcmVjdGl2ZXMgKHRoZW4gdGhlIGZvcm1hdCBpdHNlbGYgaXMgdGhlIGxpdGVyYWwgY29udGVudCkuXG4gKiBUaHJlYWRlZCBvbiBhcHBlbmRzIGFzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgYW5kIG9uIHNpbmdsZSBwbGFpbiBgPmBcbiAqIG92ZXJ3cml0ZXMgKGFuZCB0ZWUgb3BlcmFuZHMgd2l0aCBhIG9uZS1ob3AgbGl0ZXJhbCBwaXBlIHNvdXJjZSkgYXMgdGhlXG4gKiBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50LlxuICovXG5mdW5jdGlvbiBsaXRlcmFsQ29udGVudChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBhcmdzID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSB8fCBoYXNTaGVsbEV4cGFuc2lvbihhKSB8fCAvWyo/XS8udGVzdChhKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3ByaW50ZicpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggIT09IDEpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgZm10ID0gYXJnc1swXTtcbiAgICBpZiAoZm10LmluY2x1ZGVzKCclJykgfHwgZm10LmluY2x1ZGVzKCdcXFxcJykpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGZtdDtcbiAgfVxuICByZXR1cm4gYCR7YXJncy5qb2luKCcgJyl9XFxuYDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgcmVkaXJlY3QgdGFyZ2V0IGFnYWluc3QgdGhlIGN1cnJlbnQgZGlyZWN0b3J5LCBlbWl0dGluZyB0aGVcbiAqIHVucmVzb2x2ZWQgdmVyZGljdCAodGhlIHJlYWQgaWRpb21zJyByZWFzb24pIHdoZW4gdGhlIHBhdGggY2FycmllcyBhblxuICogdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iLiBSZXR1cm5zIHRoZSBhYnNvbHV0ZSBwYXRoLCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlVGFyZ2V0KHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIHRhcmdldDogc3RyaW5nLCBjdXJyZW50RGlyOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHRhcmdldCkpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICBpZGlvbSxcbiAgICAgIGZpbGVBcmc6IHRhcmdldCxcbiAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xufVxuXG4vKiogVGhlIGB0ZWVgIG9wZXJhbmQgZ3JhbW1hcjogYXBwZW5kIG1vZGUgYW5kIG9wZXJhbmQgbGlzdDsgdW5rbm93biBvcHRpb25zIHJldHVybiBudWxsIChmYWlsIGNsb3NlZCkuICovXG5mdW5jdGlvbiB0ZWVPcGVyYW5kUGFydHMoYXJndjogc3RyaW5nW10pOiB7IGFwcGVuZDogYm9vbGVhbjsgb3BlcmFuZHM6IHN0cmluZ1tdIH0gfCBudWxsIHtcbiAgbGV0IGFwcGVuZCA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3Yuc2xpY2UoMSkpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYScgfHwgYSA9PT0gJy0tYXBwZW5kJykge1xuICAgICAgYXBwZW5kID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHJldHVybiBudWxsO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgYXBwZW5kLCBvcGVyYW5kcyB9O1xufVxuXG4vKipcbiAqIFRoZSBgdGVlYCBvcGVyYW5kIHdyaXRlcyAocGxhbiBcdTAwQTc1LjEpOiBlYWNoIG9wZXJhbmQgaXMgYSB3aG9sZS1maWxlXG4gKiBjcmVhdGUtb3ZlcndyaXRlICh0cnVuY2F0aW5nKSwgb3IgYSB3aG9sZS1maWxlIGFwcGVuZCB1bmRlciBgLWFgL2AtLWFwcGVuZGAuXG4gKiBBIG9uZS1ob3AgbGl0ZXJhbCBlY2hvL3ByaW50ZiBwaXBlIHNvdXJjZSAoYGVjaG8geCB8IHRlZSBmYCwgYHByaW50ZiB5IHxcbiAqIHRlZSAtYSBmYCwgcGxhbiBcdTAwQTc1LjIpIHRocmVhZHMgYXMgdGhlIHdyaXR0ZW4gYm9keSBcdTIwMTQgdGhlIGV4YWN0IGdhdGUnc1xuICogcG9zdC1jb250ZW50IG9uIHRoZSB0cnVuY2F0aW5nIHdyaXRlLCB0aGUgc3VmZml4IGdhdGUncyBib2R5IG9uIHRoZSBhcHBlbmQ7XG4gKiB3aXRob3V0IGEga25vd24gc291cmNlIG5laXRoZXIgb3AgY2FycmllcyB3cml0dGVuIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVGVlT3BlcmFuZHMoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICBpZiAocGFydHMgPT09IG51bGwpIHJldHVybjtcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICBzcGFuOiAhcGFydHMuYXBwZW5kXG4gICAgICAgID8ge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSByZWRpcmVjdCBmYW1pbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjEpLCBydW4gZm9yIGV2ZXJ5IHNpbXBsZSBjb21tYW5kIGFmdGVyXG4gKiB0aGUgcmVhZCBtYXRjaGVyczogY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3RzIG9uIGBlY2hvYC9gcHJpbnRmYC9gdGVlYFxuICogd3JpdGUgd2hvbGUtZmlsZTsgYSBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0ZXMgKHRoZSBtYWluIHdhbGsgaGFuZHNcbiAqIGFyZ3YtZW1wdHkgY29tbWFuZHMgZGlyZWN0bHkgaGVyZSk7IGA+PmAtb25seSB0cnVuY2F0aW9uIGZvcm1zIGFwcGVuZFxuICogbm90aGluZyBhbmQgdG91Y2ggbm90aGluZy4gQW55IG90aGVyIGhvc3Qgd2l0aCBhIGNvbnRlbnQgcmVkaXJlY3QgKGBscyA+IGZgLFxuICogYHB5dGhvbjMgeC5weSA+IG91dGAsIGBjYXQgZiA+IGdgKSBnZXRzIG5vIHdyaXRlIHRvdWNoIFx1MjAxNCB0aGUgcmVkaXJlY3QgaXNcbiAqIHJlYWwsIGJ1dCBpdHMgY29udGVudCBpcyBkeW5hbWljIGFuZCBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGV4YWN0bHkgb25lIHBsYWluIGA+PmAgKG9yIGAxPj5gKSBjb250ZW50IHJlZGlyZWN0IG9uIGFcbiAqIGZ1bGx5IGxpdGVyYWwgYGVjaG9gL2BwcmludGZgIHRocmVhZHMgdGhlIHdyaXR0ZW4gYm9keSAodGhlIHN1ZmZpeCBnYXRlKSxcbiAqIGFuZCBleGFjdGx5IG9uZSBwbGFpbiBgPmAgKG9yIGAxPmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gdGhlIHNhbWUgbGl0ZXJhbHNcbiAqIHRocmVhZHMgaXQgYXMgdGhlIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiIFx1MjAxNCB0aGVcbiAqIGNvbnRlbnQgbGF5ZXIgaXMgd2hhdCBzdXBwcmVzc2VzIGBlY2hvIGhpID4gcmVhZC1vbmx5LWZpbGVgLCB3aGVyZSB0aGVcbiAqIGZpbGUgc3RheXMgcHJlc2VudCBidXQgdW5jaGFuZ2VkKS4gYCY+YC9gJj4+YCwgbXVsdGktcmVkaXJlY3QgY29tbWFuZHMsXG4gKiBhbmQgYHRlZWAncyBvd24gcmVkaXJlY3RzIG5ldmVyIHRocmVhZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZWRpcmVjdEZhbWlseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudFJlZGlyZWN0cyA9IHJlZGlyZWN0cy5maWx0ZXIoaXNDb250ZW50UmVkaXJlY3QpO1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09IHVuZGVmaW5lZCB8fCBob3N0ID09PSAnOicpIHtcbiAgICAvLyBCYXJlIGA+IGZgIGFuZCBgOiA+IGZgIHRydW5jYXRlOyBgPj5gL2AmPj5gIGFwcGVuZCBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC5cbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicgfHwgci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAndHJ1bmNhdGUtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICd0cnVuY2F0ZS13cml0ZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicgJiYgaG9zdCAhPT0gJ3RlZScpIHJldHVybjtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcbiAgY29uc3QgdGhyZWFkZWRBcHBlbmQgPSBzaW5nbGVQbGFpbkFwcGVuZCAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBjb25zdCB0aHJlYWRlZE92ZXJ3cml0ZSA9IHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZEFwcGVuZCAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZEFwcGVuZCB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZE92ZXJ3cml0ZSAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZE92ZXJ3cml0ZSB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmaWxlLW11dGF0aW9uIGZhbWlseSBncmFtbWFycyAocGxhbiBcdTAwQTc1LjNcdTIwMTNcdTAwQTc1LjcpOiBjcC9pbnN0YWxsL212L2dpdCBtdixcbi8vIHJtL2dpdCBybS90cnVuY2F0ZSwgc2VkIC1pIGluLXBsYWNlIGVkaXRzLCBhbmQgcGF0Y2gvZ2l0IGFwcGx5LiBUaGV5IHNoYXJlXG4vLyB0aGUgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlczogbGVhZGluZyBlbnYgYXNzaWdubWVudHMgKHN0cmlwcGVkIGJ5IHRoZSB3YWxrKVxuLy8gYW5kIG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBhcmUgc2tpcHBlZCAobWVjaGFuaWNhbGx5IGNlcnRhaW4pOyBhbnlcbi8vIG90aGVyIHdyYXBwZXIgaXMgdW5yZXNvbHZlZDsgYSBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvblxuLy8gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb247IGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHM7IGdsb2JiZWQgb3IgdmFyaWFibGVcbi8vIHBhdGhzIGFyZSB1bnJlc29sdmVkOyBkaXJlY3Rvcnktc2hhcGVkIHNvdXJjZSBvcGVyYW5kcyBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV3JhcHBlciB3b3JkcyB0aGF0IG9ic2N1cmUgdGhlIHdyYXBwZWQgY29tbWFuZCdzIGFyZ3YgKHBsYW4gXHUwMEE3NSk6IGEgZmFtaWx5IGNvbW1hbmQgYmVoaW5kIG9uZSBpcyB1bnJlc29sdmVkLCBuZXZlciBndWVzc2VkLiAqL1xuY29uc3QgRk9SRUlHTl9XUkFQUEVSUyA9IG5ldyBTZXQoWydzdWRvJywgJ3hhcmdzJywgJ25vaHVwJywgJ3RpbWUnLCAnbmljZScsICdkb2FzJ10pO1xuXG4vKiogU3RyaXAgYXQgbW9zdCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgXHUyMDE0IG1lY2hhbmljYWxseSB0cmFuc3BhcmVudCAocGxhbiBcdTAwQTc1KS4gKi9cbmZ1bmN0aW9uIHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICByZXR1cm4gYXJndlswXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbMF0gPT09ICdlbnYnID8gYXJndi5zbGljZSgxKSA6IGFyZ3Y7XG59XG5cbmZ1bmN0aW9uIHB1c2hVbnJlc29sdmVkKHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIGZpbGVBcmc6IHN0cmluZywgcmVhc29uOiBzdHJpbmcpOiB2b2lkIHtcbiAgcmVzdWx0cy5wdXNoKHsgc3RhdHVzOiAndW5yZXNvbHZlZCcsIGlkaW9tLCBmaWxlQXJnLCByZWFzb24gfSk7XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeSAodGhlIGRlc3QtZGlyIGRlY2lzaW9uLCBwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQ7IGZzIHN0YXQgbGlrZSB0aGUgcmVhZCBpZGlvbXMnIGxpbmUgY291bnRzKS4gKi9cbmZ1bmN0aW9uIGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0RpcmVjdG9yeSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2hhcmVkIGNwL2luc3RhbGwvbXYgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBwZXItZmFtaWx5IG9wdGlvblxuICogc2V0cyBhbmQgdG91Y2ggb3BlcmF0aW9ucyBiZWhpbmQgb25lIHBhcnNlci5cbiAqL1xuaW50ZXJmYWNlIENvcHlNb3ZlU3BlYyB7XG4gIGlkaW9tOiAnY3Atd3JpdGUnIHwgJ2luc3RhbGwtd3JpdGUnIHwgJ212LXdyaXRlJztcbiAgLyoqIEtub3duIG5vLXZhbHVlIGZsYWdzIChjb25zdW1lZCwgbmV2ZXIgb3BlcmFuZHMpLiAqL1xuICBub1ZhbHVlOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogS25vd24gdmFsdWUtdGFraW5nIGZsYWdzICh0aGUgbmV4dCB3b3JkIGlzIHRoZSB2YWx1ZSBcdTIwMTQgYC10IERJUmAsIG9yIGFuIGluc3RhbGwgbW9kZS9vd25lci9ncm91cCkuICovXG4gIHZhbHVlVGFraW5nOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogRmxhZ3MgdGhhdCBmYWlsIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAoYGNwIC1iYC9gLS1iYWNrdXBgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBkcnktcnVuIGAtbmAvYC0tZHJ5LXJ1bmApLiAqL1xuICBleGNsdWRlZDogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIFRoZSBwZXItc291cmNlIHRvdWNoOiBjcC9pbnN0YWxsIHJlYWQgdGhlaXIgc291cmNlczsgbXYgZGVsZXRlcyB0aGVtLiAqL1xuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyB8ICdkZWxldGUnO1xuICAvKiogVGhlIHBlci1kZXN0IHRvdWNoOiBjcC9pbnN0YWxsIG92ZXJ3cml0ZTsgbXYgcmVuYW1lLWNvcGllcy4gKi9cbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ3JlbmFtZS1jb3B5Jztcbn1cblxuY29uc3QgQ1BfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2NwLXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1yJywgJy1SJywgJy1wJywgJy1mJywgJy12JywgJy1uJywgJy1pJywgJy11JywgJy1hJywgJy1kJywgJy1MJywgJy1QJ10pLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctYicsICctLWJhY2t1cCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgSU5TVEFMTF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnaW5zdGFsbC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctRCcsICctcycsICctdiddKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknLCAnLW0nLCAnLW8nLCAnLWcnXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWQnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IE1WX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdtdi13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaScsICctbicsICctdicsICctdSddKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KCksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmNvbnN0IEdJVF9NVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWsnLCAnLXYnXSksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KCksXG4gIC8vIGBnaXQgbXYgLW5gL2AtLWRyeS1ydW5gIGlzIGEgdHJpYWwgcnVuIHRoYXQgbW92ZXMgbm90aGluZyAodGhlIHNhbWVcbiAgLy8gcmVhZC1vbmx5IGNsYXNzIGFzIGBwYXRjaCAtLWRyeS1ydW5gLCBwbGFuIFx1MDBBNzUuNykgXHUyMDE0IGZhaWwgY2xvc2VkLlxuICBleGNsdWRlZDogbmV3IFNldChbJy1uJywgJy0tZHJ5LXJ1biddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgZGVzdE9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5J1xufTtcblxuaW50ZXJmYWNlIENvcHlNb3ZlUGFydHMge1xuICAvKiogT3BlcmFuZHMgaW4gb3JkZXIgKHNvdXJjZXM7IGluIHRoZSBub24tYC10YCBmb3JtIHRoZSBsYXN0IGlzIHRoZSBkZXN0KS4gKi9cbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xuICAvKiogVGhlIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeWAgdmFsdWUsIG9yIG51bGwuICovXG4gIHRhcmdldERpcjogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBQYXJzZSB0aGUgb3BlcmFuZHMgb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQ6IGtub3duIG9wdGlvbnMgYXJlIGNvbnN1bWVkLFxuICogYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kcywgYW5kIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeVs9RElSXWAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIG5leHQgd29yZCBpcyB0aGUgdGFyZ2V0IGRpcmVjdG9yeSwgbmV2ZXIgYSBzb3VyY2UuIEFcbiAqIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChub1xuICogdG91Y2gpLiBSZXR1cm5zIG51bGwgd2hlbiBhIGZhaWwtY2xvc2VkIG9wdGlvbiBpcyBwcmVzZW50IG9yIGEgdmFsdWUtdGFraW5nXG4gKiBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzLlxuICovXG5mdW5jdGlvbiBjb3B5TW92ZVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBzcGVjOiBDb3B5TW92ZVNwZWMpOiBDb3B5TW92ZVBhcnRzIHwgbnVsbCB7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGkgPSAwO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXQnIHx8IGEgPT09ICctLXRhcmdldC1kaXJlY3RvcnknKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIHRhcmdldERpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS10YXJnZXQtZGlyZWN0b3J5PScpKSB7XG4gICAgICB0YXJnZXREaXIgPSBhLnNsaWNlKCctLXRhcmdldC1kaXJlY3Rvcnk9Jy5sZW5ndGgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLmV4Y2x1ZGVkLmhhcyhhKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHNwZWMudmFsdWVUYWtpbmcuaGFzKGEpKSB7XG4gICAgICBpZiAoYXJnc1tpICsgMV0gPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMubm9WYWx1ZS5oYXMoYSkpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4geyBvcGVyYW5kcywgdGFyZ2V0RGlyIH07XG59XG5cbi8qKlxuICogVGhlIHBlci1zb3VyY2UgdG91Y2ggb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQuIGNwL2luc3RhbGwgc291cmNlcyBhcmVcbiAqIHdob2xlLWZpbGUgcmVhZHMgcmVzb2x2ZWQgYWdhaW5zdCBmcyBsaWtlIHRoZSByZWFkIGlkaW9tczsgYSBzb3VyY2Ugd2hvc2VcbiAqIGxpbmUgY291bnQgY2Fubm90IGJlIHJlYWQgYXQgcGFyc2UgdGltZSAobWlzc2luZyBvciB1bnJlYWRhYmxlIFx1MjAxNCB0aGUgcGFyc2VcbiAqIHJ1bnMgcG9zdC1jb21tYW5kLCBzbyBhIHNvdXJjZSB0aGUgY29tcG91bmQncyBvd24gZWFybGllciBgcm1gIGRlbGV0ZWQgaXNcbiAqIGV4YWN0bHkgdGhpcykgc3RpbGwgcmVzb2x2ZXMgYXMgYSByYW5nZS1sZXNzIHdob2xlLWZpbGUgcmVhZDogdGhlIGRyaXZlclxuICogcGFpcnMgdGhlIGRlc3RpbmF0aW9uIGFnYWluc3QgaXQsIHNvIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwXG4gKiAxYikgYW5kIHRoZSByZWFkJ3MgcG9zdC1jb21tYW5kIGV4aXN0ZW5jZSBnYXRlIGFwcGx5IFx1MjAxNCBhbiB1bmV4cGxhaW5lZFxuICogYWJzZW5jZSBmYWlscyB0aGUgY29weSBkZWNpc2l2ZWx5IGFuZCBhIHBoYW50b20gc291cmNlIG5ldmVyIGZpcmVzIHRoZVxuICogZGVzdC4gVGhlIG12IHNvdXJjZSBpcyBhIGRlbGV0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFNvdXJjZVNwYW4oXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBzcGVjOiBDb3B5TW92ZVNwZWMsXG4gIGFic29sdXRlUGF0aDogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAoc3BlYy5zb3VyY2VPcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LCAoKSA9PiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpKTtcbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgc3BhbjpcbiAgICAgIHJhbmdlID09PSBudWxsXG4gICAgICAgID8geyBvcGVyYXRpb246ICdyZWFkJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pblxuICAgICAgICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGNwL2luc3RhbGwvbXYgZmFtaWx5IChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBvcGVyYW5kcyByZXNvbHZlIHRvIHNvdXJjZS9kZXN0XG4gKiBwYWlycyBcdTIwMTQgZWFjaCBzb3VyY2UgaXMgYSByZWFkIChjcC9pbnN0YWxsKSBvciBkZWxldGUgKG12KSwgZWFjaCBkZXN0IGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKGNwL2luc3RhbGwpIG9yIHJlbmFtZS1jb3B5IChtdiksIHNvdXJjZXMgYmVmb3JlIGRlc3RzIGluXG4gKiBkZWNsYXJhdGlvbiBvcmRlci4gQSBkZXN0IHRoYXQgZW5kcyBpbiBgL2Agb3Igc3RhdHMgYXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5XG4gKiBtYXBzIHRvIGBkaXIvYmFzZW5hbWUoc291cmNlKWAgcGVyIHNvdXJjZTsgYC10IERJUmAvYC0tdGFyZ2V0LWRpcmVjdG9yeT1ESVJgXG4gKiBtYXBzIHRoZSBzYW1lIHdheSBhbmQgaXMgdW5yZXNvbHZlZCB3aGVuIGl0cyB2YWx1ZSBpcyBub3QgZGlyZWN0b3J5LXNoYXBlZC5cbiAqIE11bHRpLXNvdXJjZSBjb21tYW5kcyBuZWVkIGEgZGlyZWN0b3J5IGRlc3Q7IGEgZGlyZWN0b3J5LXNoYXBlZCBvclxuICogZ2xvYmJlZC92YXJpYWJsZSBzb3VyY2UsIGEgZ2xvYmJlZC92YXJpYWJsZSBkZXN0LCBvciBhIGZhaWwtY2xvc2VkIG9wdGlvblxuICogKGBjcCAtYmAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGAtbmApIGVtaXRzIG5vIHRvdWNoZXMuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ29weU1vdmVGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IHNwZWM6IENvcHlNb3ZlU3BlYyB8IG51bGwgPSBudWxsO1xuICBsZXQgYXJnczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGRpciA9IGRpckZvclJlc29sdXRpb247XG4gIGlmIChjb21tYW5kID09PSAnY3AnIHx8IGNvbW1hbmQgPT09ICdpbnN0YWxsJyB8fCBjb21tYW5kID09PSAnbXYnKSB7XG4gICAgc3BlYyA9IGNvbW1hbmQgPT09ICdjcCcgPyBDUF9TUEVDIDogY29tbWFuZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogTVZfU1BFQztcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdtdicpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnbXYtd3JpdGUnLCAnbXYnLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNwZWMgPSBHSVRfTVZfU1BFQztcbiAgICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICAgIGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgfVxuICB9IGVsc2UgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgLy8gQSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IGZhaWwgY2xvc2VkIHJhdGhlciB0aGFuIG1pcy1wYXJzZS5cbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBjb25zdCB3cmFwcGVkU3BlYyA9XG4gICAgICB3cmFwcGVkID09PSAnY3AnID8gQ1BfU1BFQyA6IHdyYXBwZWQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IHdyYXBwZWQgPT09ICdtdicgPyBNVl9TUEVDIDogbnVsbDtcbiAgICBpZiAod3JhcHBlZFNwZWMgIT09IG51bGwpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHdyYXBwZWRTcGVjLmlkaW9tLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoc3BlYyA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gIGNvbnN0IHBhcnRzID0gY29weU1vdmVQYXJ0cyhhcmdzLCBzcGVjKTtcbiAgaWYgKHBhcnRzID09PSBudWxsIHx8IHBhcnRzLm9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIC8vIFJlc29sdmUgZXZlcnkgc291cmNlIGJlZm9yZSBlbWl0dGluZyBhbnl0aGluZzogYSBkaXJlY3Rvcnktc2hhcGVkLFxuICAvLyBnbG9iYmVkLCBvciB2YXJpYWJsZSBzb3VyY2UgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkICh0aGUgZGVzdFxuICAvLyBtYXBwaW5nIGlzIHBlci1zb3VyY2UsIHNvIGFuIHVua25vd2FibGUgc291cmNlIG1ha2VzIHRoZSBkZXN0cyB1bmtub3dhYmxlKS5cbiAgY29uc3Qgc291cmNlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc291cmNlIG9mIHBhcnRzLm9wZXJhbmRzLnNsaWNlKDAsIHBhcnRzLnRhcmdldERpciA9PT0gbnVsbCA/IC0xIDogdW5kZWZpbmVkKSkge1xuICAgIGlmIChzb3VyY2UuZW5kc1dpdGgoJy8nKSkgcmV0dXJuO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgc3BlYy5pZGlvbSwgc291cmNlLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSByZXR1cm47XG4gICAgc291cmNlUGF0aHMucHVzaChhYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgZGVzdFBhdGhzOiBzdHJpbmdbXTtcbiAgaWYgKHBhcnRzLnRhcmdldERpciAhPT0gbnVsbCkge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShwYXJ0cy50YXJnZXREaXIpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXBhcnRzLnRhcmdldERpci5lbmRzV2l0aCgnLycpICYmICFpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKSkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3RoZSAtdCB0YXJnZXQgaXMgbm90IGFuIGV4aXN0aW5nIGRpcmVjdG9yeScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRBYnMgPSByZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcik7XG4gICAgZGVzdFBhdGhzID0gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aCh0YXJnZXRBYnMsIGJhc2VuYW1lKHApKSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgZGVzdCA9IHBhcnRzLm9wZXJhbmRzW3BhcnRzLm9wZXJhbmRzLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShkZXN0KSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRlc3RBYnMgPSByZXNvbHZlUGF0aChkaXIsIGRlc3QpO1xuICAgIGNvbnN0IGRlc3RJc0RpciA9IGRlc3QuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGRlc3RBYnMpO1xuICAgIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPiAxICYmICFkZXN0SXNEaXIpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdhIG11bHRpLXNvdXJjZSBjb3B5L21vdmUgbmVlZHMgYSBkaXJlY3RvcnkgZGVzdGluYXRpb24nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZGVzdFBhdGhzID0gZGVzdElzRGlyID8gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aChkZXN0QWJzLCBiYXNlbmFtZShwKSkpIDogW2Rlc3RBYnNdO1xuICB9XG5cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIGVtaXRTb3VyY2VTcGFuKHJlc3VsdHMsIHNwZWMsIHNvdXJjZVBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogc3BlYy5kZXN0T3BlcmF0aW9uLCBhYnNvbHV0ZVBhdGg6IGRlc3RQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG5jb25zdCBSTV9OT19WQUxVRSA9IG5ldyBTZXQoWyctZicsICctaScsICctdiddKTtcbi8qKiBgcm1gL2BnaXQgcm1gIGZsYWdzIHdob3NlIHNlbWFudGljcyBhcmUgb3V0IG9mIHNjb3BlOiByZWN1cnNpdmUgcmVtb3ZhbCBhbmQgcm1kaXIuICovXG5jb25zdCBSTV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCddKTtcbi8qKiBgZ2l0IHJtYCBhZGRzIHRoZSBkcnktcnVuIGZvcm0gdG8gdGhlIGV4Y2x1c2lvbnMuICovXG5jb25zdCBHSVRfUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnLCAnLW4nLCAnLS1kcnktcnVuJ10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcm0vZ2l0IHJtIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBhIHJlY3Vyc2l2ZS9ybWRpciBmbGFnIChvclxuICogYC0tY2FjaGVkYCBmb3IgZ2l0IHJtIFx1MjAxNCB0aGUgd29ya3RyZWUgZmlsZSBzdXJ2aXZlcykgZXhjbHVkZXMgdGhlIHdob2xlXG4gKiBjb21tYW5kOyBlYWNoIHJlbWFpbmluZyBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgZGVsZXRlLCBhbmQgYVxuICogZGlyZWN0b3J5LXNoYXBlZCBvcGVyYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4gIGV4Y2x1ZGVDYWNoZWQ6IGJvb2xlYW4sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChleGNsdWRlZC5oYXMoYSkgfHwgKGV4Y2x1ZGVDYWNoZWQgJiYgYSA9PT0gJy0tY2FjaGVkJykpIHJldHVybjtcbiAgICBpZiAoUk1fTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdybS13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFN0YXRpY2FsbHkgZXZhbHVhdGUgYW4gYWJzb2x1dGUgYHRydW5jYXRlIC1zYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IGEgcGxhaW5cbiAqIGludGVnZXIgd2l0aCBhbiBvcHRpb25hbCBLL00vRyBzdWZmaXguIFJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLFxuICogYC1yIHJlZmAgdmFsdWVzLCBhbmQgc2hlbGwtZXhwYW5kZWQgdmFsdWVzIGRlcGVuZCBvbiBydW50aW1lIHN0YXRlIFx1MjE5MlxuICogdW5kZWZpbmVkICh0aG9zZSBzcGFucyBnYXRlIGV4aXN0ZW5jZS1vbmx5KS5cbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVTdGF0aWNTaXplKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgbSA9IHZhbHVlLm1hdGNoKC9eKFxcZCspKFtLTUddKT8kLyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBiYXNlID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgY29uc3QgbXVsdCA9IG1bMl0gPT09ICdLJyA/IDEwMjQgOiBtWzJdID09PSAnTScgPyAxMDI0ICoqIDIgOiBtWzJdID09PSAnRycgPyAxMDI0ICoqIDMgOiAxO1xuICByZXR1cm4gYmFzZSAqIG11bHQ7XG59XG5cbi8qKlxuICogVGhlIHRydW5jYXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYC1zIFNJWkVgL2AtciByZWZgIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZVxuICogc2l6ZSB2YWx1ZSBtYXkgaXRzZWxmIGxlYWQgd2l0aCBgLWAgKGB0cnVuY2F0ZSAtcyAtMTAgZmApIFx1MjAxNCBhbmQgYC1jYCBpc1xuICogY29tcGF0aWJsZS4gV2l0aG91dCBgLXNgL2AtcmAgdGhlIGNvbW1hbmQgY2hhbmdlcyBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC4gRWFjaFxuICogZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIHRydW5jYXRlOyBhbiBhYnNvbHV0ZSBgLXMgTmAgY2FycmllcyB0aGUgc3RhdGljYWxseVxuICogZXZhbHVhdGVkIHNpemUgb24gdGhlIHNwYW4gKHRoZSBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQsXG4gKiBgLXMgMGAgXHUyMTkyIGVtcHR5KSwgcmVsYXRpdmUgc2l6ZXMgYW5kIGAtciByZWZgIHN0YXkgZXhpc3RlbmNlLW9ubHkuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHNhd1NpemVGbGFnID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGxldCBzdGF0aWNTaXplOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IG9wZXJhbmRzOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgc2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSBldmFsdWF0ZVN0YXRpY1NpemUoYXJnc1tpICsgMV0pO1xuICAgICAgaSArPSAxOyAvLyBjb25zdW1lIHRoZSBzaXplIHZhbHVlLCBldmVuIHdoZW4gaXQgbGVhZHMgd2l0aCBgLWBcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1yJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IHVuZGVmaW5lZDsgLy8gdGhlIGxhc3Qgc2l6ZSBvcHRpb24gd2luczsgYSByZWYgaGFzIG5vIHN0YXRpYyB2YWx1ZVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgfVxuICBpZiAoIXNhd1NpemVGbGFnKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kLnBhdGgpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAndHJ1bmNhdGUtY29tbWFuZCcsIG9wZXJhbmQucGF0aCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQucGF0aC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3RydW5jYXRlJyxcbiAgICAgICAgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCksXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKG9wZXJhbmQuc2l6ZSAhPT0gdW5kZWZpbmVkID8geyBzaXplOiBvcGVyYW5kLnNpemUgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJtL2dpdCBybS90cnVuY2F0ZSBmYW1pbHkgKHBsYW4gXHUwMEE3NS41KTogYHJtYC9gZ2l0IHJtYCBvcGVyYW5kcyBhcmVcbiAqIGRlbGV0ZXMsIGB0cnVuY2F0ZWAgb3BlcmFuZHMgYXJlIHRydW5jYXRpb25zIChvbmx5IHdoZW4gYC1zYC9gLXJgIGlzXG4gKiBwcmVzZW50KS4gYGdpdCBybSAtLWNhY2hlZGAgdG91Y2hlcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtVHJ1bmNhdGUoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdybScpIHtcbiAgICBtYXRjaFJtT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgUk1fRVhDTFVERUQsIGZhbHNlLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ3RydW5jYXRlJykge1xuICAgIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAncm0nKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgJ3JtJywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBtYXRjaFJtT3BlcmFuZHMoXG4gICAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgICBHSVRfUk1fRVhDTFVERUQsXG4gICAgICAgIHRydWUsXG4gICAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgcmVzdWx0c1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncm0nIHx8IHdyYXBwZWQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncm0nID8gJ3JtLXdyaXRlJyA6ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2Mgd3JpdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjIpIGZvciB0aGUgaG9zdCBmYW1pbGllcyB3aG9zZSBib2RpZXMgYXJlXG4gKiBjb250ZW50OiBgY2F0YCAoYm9keSBcdTIxOTIgdGhlIGNvbnRlbnQgcmVkaXJlY3RzKSwgYHRlZWAgKGJvZHkgXHUyMTkyIHRoZSBvcGVyYW5kcyksXG4gKiBhbmQgYHBhdGNoYC9gZ2l0IGFwcGx5YCAoYm9keSBcdTIxOTIgcGF0Y2ggdGV4dCwgXHUwMEE3NS43KS4gQW55IG90aGVyIGhvc3QncyBoZXJlZG9jXG4gKiBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgc3RkaW4tb25seSBhbmQgbm9uLWZhbWlseSBjb21tYW5kc1xuICogKGBweXRob24zIC0gPDxFT0YgPiBvdXRgLCBgbHMgPiBvdXQgPDxFT0ZgKSBnZXQgbm8gd3JpdGUgdG91Y2gsIGFuZFxuICogcmVhZC1mYW1pbHkgY29tbWFuZHMgKGBzZWQgLW4gJzEsMnAnIDw8RU9GYCkgZmFsbCB0aHJvdWdoIHRvIHRoZSByZWFkXG4gKiBtYXRjaGVycy4gRW1wdHkgYD4+YC1ib2RpZXMgYXBwZW5kIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmc7IGVtcHR5IGA+YC1ib2RpZXNcbiAqIHRydW5jYXRlICh3aG9sZS1maWxlLCB0aGUgRjIgcnVsZSkuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGA+PmAgYXBwZW5kcyBhbmQgYD5gIG92ZXJ3cml0ZXMgdGhyZWFkIHRoZSBib2R5IHdoZW4gdGhlXG4gKiBjb250ZW50IHJlZGlyZWN0IGlzIHNpbmdsZSBhbmQgcGxhaW4gXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IG9uIHRoZVxuICogb3ZlcndyaXRlICh0aGUgdHJhaWxpbmcgYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBzIGlzIHJlc3RvcmVkLCBzaW5jZSB0aGVcbiAqIGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzKSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMWIgbGlzdHMgXCJ0ZWUvaGVyZWRvYyB3aXRoIGEgbGl0ZXJhbCBib2R5XCIgaW4gdGhlIGV4YWN0IGNsYXNzKS5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlIZXJlZG9jT3BlbmVyKFxuICBvcGVuZXI6IHN0cmluZyxcbiAgYm9keTogc3RyaW5nLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhvcGVuZXIpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybjtcbiAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcblxuICBjb25zdCBlbWl0Q29udGVudFJlZGlyZWN0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5BcHBlbmQgJiYgci5vcCA9PT0gJz4+JyA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAvLyBUaGUgZXhhY3QgZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMsIHNvIHRoZSB0cmFpbGluZ1xuICAgICAgICAgICAgICAgICAgLy8gYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBwZWQgY29tZXMgYmFjayBvbiB0aGUgb3ZlcndyaXRlLlxuICAgICAgICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluT3ZlcndyaXRlID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGlmIChob3N0ID09PSAnY2F0Jykge1xuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykge1xuICAgIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICAgIGlmIChwYXJ0cyAhPT0gbnVsbCkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGlmIChwYXJ0cy5hcHBlbmQpIHtcbiAgICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhbWUgcmVzdG9yZWQtYFxcbmAgZXhhY3QgYm9keSBhcyB0aGUgcmVkaXJlY3QgYnJhbmNoOyBhXG4gICAgICAgICAgICAgICAgICAgIC8vIHRlZSBvcGVyYW5kIHdpdGggYSBjb250ZW50IHJlZGlyZWN0IHByZXNlbnQga2VlcHMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIHJlZGlyZWN0J3MgdGhyZWFkaW5nIG9ubHkgKG1pcnJvciBvZiB0aGUgYXBwZW5kIGJyYW5jaCkuXG4gICAgICAgICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3BhdGNoJyB8fCBob3N0ID09PSAnZ2l0Jykge1xuICAgIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKGFyZ3YsIGJvZHksIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE5vbi1mYW1pbHkgaG9zdDogdGhlIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBubyB3cml0ZSB0b3VjaC5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgc2VkIC1pIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS42KSwgdGhlIGZpcnN0IGNvbnN1bWVyIG9mIGV4YWN0IHJhbmdlczogYVxuLy8gc3Vic3RpdHV0aW9uLW9ubHkgc2NyaXB0IHdpdGggbnVtZXJpYyBhZGRyZXNzZXMgbW9kaWZpZXMgdGhlIGFkZHJlc3NlZFxuLy8gbGluZXM7IGFueXRoaW5nIGxlc3Mgc3RhdGljYWxseSBjZXJ0YWluIGlzIGEgd2hvbGUtZmlsZSBtb2RpZnkuIFRoZVxuLy8gc3VmZml4L3NjcmlwdCBkaXNhbWJpZ3VhdGlvbiBhbmQgdGhlIHNlZ21lbnQgY2xhc3NpZmljYXRpb24gYmVsb3cgYXJlIHRoZVxuLy8gd2hvbGUgb2YgaXQgXHUyMDE0IGV2ZXJ5dGhpbmcgZWxzZSBmb2xsb3dzIHRoZSBzaGFyZWQgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlcy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCAoYE5gLCBgTixNYCkgXHUyMDE0IHRoZSBvbmx5IGZvcm0gd2l0aCBhbiBleGFjdCByYW5nZS4gKi9cbmNvbnN0IE5VTUVSSUNfU1VCU1RJVFVUSU9OID0gL14oXFxkKykoPzosKFxcZCspKT9bc3ldLztcblxuLyoqIEFuIHVuYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IFx1MjAxNCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHdob2xlIGZpbGUgYWRkcmVzc2VkLiAqL1xuY29uc3QgVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTiA9IC9eW3N5XS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3NlZCcpIHtcbiAgICBtYXRjaFNlZElucGxhY2VBcmdzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAnc2VkJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzZWQgLWkgb3BlcmFuZCBncmFtbWFyOiBgLWlgIGJhcmUsIGAtaVNVRkZJWGAgYXR0YWNoZWQsIG9yIGEgc2VwYXJhdGVcbiAqIHN1ZmZpeCB3b3JkIHJlc29sdmVkIGJ5IHRoZSBzdGFuZGFyZCBkaXNhbWJpZ3VhdGlvbiBcdTIwMTQgdGhlIHdvcmQgYWZ0ZXIgYC1pYFxuICogaXMgdGhlIHN1ZmZpeCBvbmx5IHdoZW4gaXQgZG9lcyBub3Qgc3RhcnQgd2l0aCBgLWAgYW5kIGEgc2NyaXB0IHBsdXMgYXRcbiAqIGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IGl0ICh0aGUgQlNEIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nO1xuICogR05VJ3MgYXR0YWNoZWQtb25seSByZWFkaW5nIG90aGVyd2lzZSkuIEFuIGF0dGFjaGVkIG9yIGRpc2FtYmlndWF0ZWQgc3VmZml4XG4gKiBpcyBhIGJhY2t1cDogYSBub24tZW1wdHkgc3VmZml4IGVtaXRzIGFuIGFkZGl0aW9uYWwgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaFxuICogb24gYDxmaWxlPjxTVUZGSVg+YDsgYW4gZW1wdHkgc3VmZml4ICh3aGljaCB0aGUgcXVvdGUtYXdhcmUgdG9rZW5pemVyIGRyb3BzXG4gKiBlbnRpcmVseSBcdTIwMTQgYHNlZCAtaSAnJyBmYCBhbmQgYHNlZCAtaSBmYCB0b2tlbml6ZSBhbGlrZSkgY3JlYXRlcyBubyBiYWNrdXAuXG4gKlxuICogVGhlIHNjcmlwdCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IHBsdXMgZXZlcnkgYC1lYCBhcmd1bWVudCwgc3BsaXQgb24gYDtgLlxuICogU2VnbWVudHMgdGhhdCBhcmUgYWxsIG51bWVyaWMtYWRkcmVzc2VkIHN1YnN0aXR1dGlvbnMgeWllbGQgdGhlIGV4YWN0IHJhbmdlXG4gKiBbbWluIHN0YXJ0LCBtaW4obWF4IGVuZCwgRU9GKV0gKHBlciBmaWxlLCBFT0YgZnJvbSB0aGUgcG9zdC1lZGl0IGNvdW50KTtcbiAqIHNlZ21lbnRzIHRoYXQgYXJlIGFsbCBzdWJzdGl0dXRpb25zIFx1MjAxNCBhbnkgbnVtZXJpYy91bmFkZHJlc3NlZCBtaXggXHUyMDE0IGFyZVxuICogc3RpbGwgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCBzbyB0aGUgd2hvbGUgZmlsZSBpcyBhZGRyZXNzZWQgKFsxLCBFT0ZdKTtcbiAqIGFueSBjb3VudC1jaGFuZ2luZywgcGF0dGVybi1hZGRyZXNzZWQsIHN0ZXAsIG9yIGAkYC1hZGRyZXNzZWQgc2VnbWVudCBpcyBhXG4gKiB3aG9sZS1maWxlIG1vZGlmeSB3aXRoIG5vIHJhbmdlLiBBbiBhYnNlbnQgc2NyaXB0IChubyBzY3JpcHQgYXJndW1lbnQsIG5vXG4gKiBgLWVgKSBpcyB1bnJlc29sdmVkLlxuICovXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2VBcmdzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3VmZml4OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNhd0lucGxhY2UgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBlU2NyaXB0czogc3RyaW5nW10gPSBbXTtcbiAgLy8gVGhlIHNjcmlwdC9maWxlIHNwbGl0IG9mIHRoZSBwb3NpdGlvbmFscyBpcyBkZXJpdmVkIGFmdGVyIHRoZSBzY2FuOiB0aGVcbiAgLy8gZmlyc3QgcG9zaXRpb25hbCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IG9ubHkgd2hlbiBubyBgLWVgIHNjcmlwdCBleGlzdHMgXHUyMDE0XG4gIC8vIHdpdGggYC1lYCBwcmVzZW50IGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYSBmaWxlIChHTlUgc2VkIHJlYWRzIHRoZSBzY3JpcHRcbiAgLy8gZnJvbSBgLWVgIHRoZW4sIG5vdCBmcm9tIHRoZSBmaXJzdCBwb3NpdGlvbmFsKS5cbiAgY29uc3QgcG9zaXRpb25hbHM6IHN0cmluZ1tdID0gW107XG4gIC8vIEZpbGVzIHB1c2hlZCBvdXRzaWRlIHRoZSBwb3NpdGlvbmFsIHBhdGg6IGBzZWQgLWkgZmAgKHNjcmlwdCBhYnNlbnQpLlxuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcblxuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgYSwgJ3RoZSAtZSBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGVTY3JpcHRzLnB1c2godik7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctaScpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgY29uc3QgdyA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBgc2VkIC1pYCB3aXRoIG5vdGhpbmcgYWZ0ZXI6IG5vIHN1ZmZpeCwgbm8gc2NyaXB0IFx1MjAxNCB0aGUgYWJzZW50LXNjcmlwdFxuICAgICAgICAvLyBjaGVjayBiZWxvdyByZXNvbHZlcyB0aGlzIHVucmVzb2x2ZWQuXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAody5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgICAgLy8gVGhlIHdvcmQgYWZ0ZXIgLWkgaXMgYW4gb3B0aW9uLCBuZXZlciBhIHN1ZmZpeC5cbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3RBZnRlciA9IGFyZ3Muc2xpY2UoaSArIDIpO1xuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPj0gMikge1xuICAgICAgICAvLyBUaGUgQlNEIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOiB3IGlzIHRoZSBzdWZmaXgsIGFuZCBhIHNjcmlwdCBwbHVzXG4gICAgICAgIC8vIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93LlxuICAgICAgICBzdWZmaXggPSB3O1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gYHNlZCAtaSBmYDogdyBpcyB0aGUgbGFzdCB0b2tlbiBcdTIwMTQgbm8gc2NyaXB0IGNhbiBmb2xsb3csIHNvIHcgaXMgdGhlXG4gICAgICAgIC8vIGZpbGUgb3BlcmFuZCB3aXRoIHRoZSBzY3JpcHQgYWJzZW50IChHTlUgaW5zdGVhZCByZWFkcyB3IGFzIGEgc2NyaXB0XG4gICAgICAgIC8vIGFuZCBlcnJvcnM7IGVpdGhlciB3YXkgdGhlIGVkaXQgZG9lcyBub3QgaGFwcGVuKS5cbiAgICAgICAgZmlsZXMucHVzaCh3KTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIE9uZSB0b2tlbiBhZnRlciB3OiB3IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgKG9yIGEgZmlsZSwgd2hlbiBgLWVgXG4gICAgICAvLyBzY3JpcHRzIGFyZSBwcmVzZW50KSBhbmQgdGhlIHRva2VuIGlzIGEgZmlsZSBcdTIwMTQgY29uc3VtZSBib3RoLCBzb1xuICAgICAgLy8gbmVpdGhlciBmYWxscyB0aHJvdWdoIHRvIHRoZSBwb3NpdGlvbmFsIHBhdGggYWdhaW4uXG4gICAgICBwb3NpdGlvbmFscy5wdXNoKHcsIHJlc3RBZnRlclswXSk7XG4gICAgICBpICs9IDM7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLWknKSAmJiBhLmxlbmd0aCA+IDIpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgc3VmZml4ID0gYS5zbGljZSgyKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIC8vIFVua25vd24gb3B0aW9uIFx1MjAxNCBuZXZlciBhIHNjcmlwdCBvciBmaWxlLlxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG5cbiAgaWYgKCFzYXdJbnBsYWNlKSByZXR1cm47IC8vIG5vdCBhbiBpbi1wbGFjZSBlZGl0IGF0IGFsbFxuICBjb25zdCBzY3JpcHRBcmcgPSBlU2NyaXB0cy5sZW5ndGggPT09IDAgPyAocG9zaXRpb25hbHNbMF0gPz8gbnVsbCkgOiBudWxsO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzLnNsaWNlKDEpKTtcbiAgZWxzZSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzKTtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIHNlZ21lbnRzLnB1c2goLi4uc2NyaXB0QXJnLnNwbGl0KCc7JykpO1xuICBmb3IgKGNvbnN0IHMgb2YgZVNjcmlwdHMpIHNlZ21lbnRzLnB1c2goLi4ucy5zcGxpdCgnOycpKTtcbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGZpbGVzWzBdID8/ICdzZWQnLCAnbm8gc2NyaXB0IChhYnNlbnQgb3IgZW1wdHkgc2NyaXB0IGFyZ3VtZW50KScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFNlZ21lbnQgY2xhc3NpZmljYXRpb246IGV4YWN0IHdoZW4gZXZlcnkgc2VnbWVudCBpcyBhIG51bWVyaWMtYWRkcmVzc2VkXG4gIC8vIHN1YnN0aXR1dGlvbjsgZXhwbGljaXQgd2hvbGUtZmlsZSBbMSwgRU9GXSB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgc3RpbGwgYVxuICAvLyBzdWJzdGl0dXRpb24gKGFueSB1bmFkZHJlc3NlZC9udW1lcmljIG1peCk7IG5vIHJhbmdlIG90aGVyd2lzZS5cbiAgbGV0IGFsbE51bWVyaWMgPSB0cnVlO1xuICBsZXQgYWxsU3Vic3RpdHV0aW9uID0gdHJ1ZTtcbiAgbGV0IG1pblN0YXJ0ID0gSW5maW5pdHk7XG4gIGxldCBtYXhFbmQgPSAwO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICBjb25zdCBtID0gc2VnbWVudC5tYXRjaChOVU1FUklDX1NVQlNUSVRVVElPTik7XG4gICAgaWYgKG0gPT09IG51bGwpIHtcbiAgICAgIGFsbE51bWVyaWMgPSBmYWxzZTtcbiAgICAgIGlmICghVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTi50ZXN0KHNlZ21lbnQpKSBhbGxTdWJzdGl0dXRpb24gPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBzID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCBlID0gbVsyXSA9PT0gdW5kZWZpbmVkID8gcyA6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCk7XG4gICAgbWluU3RhcnQgPSBNYXRoLm1pbihtaW5TdGFydCwgcyk7XG4gICAgbWF4RW5kID0gTWF0aC5tYXgobWF4RW5kLCBlKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZiBvZiBmaWxlcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShmKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZiwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBmKTtcbiAgICBpZiAoYWxsTnVtZXJpYyB8fCBhbGxTdWJzdGl0dXRpb24pIHtcbiAgICAgIGNvbnN0IHRvdGFsID0gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgICByZXN1bHRzLFxuICAgICAgICAgICdzZWQtaW5wbGFjZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIG1pc3NpbmcpJ1xuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN0YXJ0ID0gYWxsTnVtZXJpYyA/IG1pblN0YXJ0IDogMTtcbiAgICAgIGNvbnN0IGVuZCA9IGFsbE51bWVyaWMgPyBNYXRoLm1pbihtYXhFbmQsIHRvdGFsKSA6IHRvdGFsO1xuICAgICAgaWYgKHN0YXJ0ID4gZW5kKSBjb250aW51ZTsgLy8gdGhlIGFkZHJlc3NlZCByYW5nZSBsaWVzIGJleW9uZCBFT0YgXHUyMDE0IG5vdGhpbmcgaXMgbW9kaWZpZWRcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHN1ZmZpeCAhPT0gbnVsbCAmJiBzdWZmaXggIT09ICcnKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGg6IGAke2Fic29sdXRlUGF0aH0ke3N1ZmZpeH1gLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBhdGNoIC8gZ2l0IGFwcGx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KS4gUGF0Y2ggdGV4dCBzb3VyY2VzLCBpbiBvcmRlciBvZlxuLy8gcmVjb2duaXRpb246IGEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGBnaXQgYXBwbHkgPGZpbGU+YCBcdTIwMTQgYSBgcGF0Y2hgXG4vLyBvcGVyYW5kIGlzIGEgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSwgYW5kIGlzIGlnbm9yZWQpLCB0aGUgc3RkaW4gYDxgXG4vLyBzb3VyY2UgKGBwYXRjaCAtcE4gPCBmaWxlYCwgYGdpdCBhcHBseSAtIDwgZmlsZWApLCBvciBhIGhlcmVkb2MgYm9keVxuLy8gKGNsYXNzaWZ5UGF0Y2hIZXJlZG9jLCBcdTAwQTc1LjIpLiBSZWFkLW9ubHkgbW9kZXMgKGAtLWNoZWNrYC9gLS1zdGF0YC9cbi8vIGAtLW51bXN0YXRgL2AtLXN1bW1hcnlgLCBgcGF0Y2ggLS1kcnktcnVuYCkgYW5kIGluZGV4LW9ubHkgYC0tY2FjaGVkYCB0b3VjaFxuLy8gbm90aGluZzsgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQgKGl0IHJld3JpdGVzIHBhdGNoIHBhdGhzKS4gQSBjb21tYW5kXG4vLyB3aXRoIG5vIHN0YXRpY2FsbHkga25vd24gc291cmNlIChwaXBlZCBvciB0ZXJtaW5hbCBzdGRpbiwgYSB2YXJpYWJsZSBwYXRjaFxuLy8gcGF0aCkgaXMgdW5yZXNvbHZlZC4gVGFyZ2V0cyBhbmQgcmFuZ2VzIGNvbWUgZnJvbSB0aGUgbmV3XG4vLyByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHVuaWZpZWQtZGlmZi50cykuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzaGFyZWQgYHBhdGNoYC9gZ2l0IGFwcGx5YCBvcHRpb24gc3VyZmFjZSAocGxhbiBcdTAwQTc1LjcpOiBzdHJpcCBsZXZlbCwgcmVhZC1vbmx5IGFuZCBpbmRleC1vbmx5IG1vZGVzLCBgLS1kaXJlY3RvcnlgLCBhbmQgb3BlcmFuZHMuICovXG5pbnRlcmZhY2UgUGF0Y2hBcHBseVBhcnRzIHtcbiAgc3RyaXA6IFBhdGhTdHJpcDtcbiAgcmVhZE9ubHk6IGJvb2xlYW47XG4gIGNhY2hlZE9ubHk6IGJvb2xlYW47XG4gIGRpcmVjdG9yeTogYm9vbGVhbjtcbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBwYXRjaEFwcGx5UGFydHMoYXJnczogc3RyaW5nW10sIGlzR2l0QXBwbHk6IGJvb2xlYW4pOiBQYXRjaEFwcGx5UGFydHMge1xuICBsZXQgc3RyaXA6IFBhdGhTdHJpcCA9IGlzR2l0QXBwbHkgPyAxIDogJ2F1dG8nO1xuICBsZXQgcmVhZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGNhY2hlZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGRpcmVjdG9yeSA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgICBpZiAoYSA9PT0gJy0tY2hlY2snIHx8IGEgPT09ICctLXN0YXQnIHx8IGEgPT09ICctLW51bXN0YXQnIHx8IGEgPT09ICctLXN1bW1hcnknKSB7XG4gICAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0tY2FjaGVkJykge1xuICAgICAgICBjYWNoZWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0taW5kZXgnIHx8IGEgPT09ICctUicgfHwgYSA9PT0gJy0tcmV2ZXJzZScgfHwgYSA9PT0gJy0tdW5zYWZlLXBhdGhzJyB8fCBhID09PSAnLS1yZWplY3QnKSBjb250aW51ZTtcbiAgICAgIGlmIChhID09PSAnLS1kaXJlY3RvcnknKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1kaXJlY3Rvcnk9JykpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBwYXRjaFxuICAgIGlmIChhID09PSAnLS1kcnktcnVuJykge1xuICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLU4nIHx8IGEgPT09ICctLWZvcndhcmQnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgc3RyaXAsIHJlYWRPbmx5LCBjYWNoZWRPbmx5LCBkaXJlY3RvcnksIG9wZXJhbmRzIH07XG59XG5cbi8qKiBUaGUgcGF0Y2ggdGV4dCBhdCBgYWJzb2x1dGVQYXRoYCwgb3IgbnVsbCB3aGVuIGl0IGNhbid0IGJlIHJlYWQuICovXG5mdW5jdGlvbiByZWFkUGF0Y2hGaWxlKGFic29sdXRlUGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogRW1pdCB0aGUgd3JpdGUgdG91Y2hlcyBmb3IgYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGNvbW1hbmQgd2l0aCBhIHN0YXRpY2FsbHlcbiAqIGtub3duIHBhdGNoLXRleHQgc291cmNlLiBgdGFyZ2V0RGlyYCBpcyB3aGVyZSB0aGUgcGF0Y2gncyB0YXJnZXQgcGF0aHNcbiAqIHJlc29sdmUgKHRoZSBnaXQgYC1DYCBkaXJlY3RvcnkgZm9yIGBnaXQgYXBwbHlgLCB0aGUgY3VycmVudCBkaXJlY3RvcnlcbiAqIG90aGVyd2lzZSk7IGBzaGVsbERpcmAgaXMgd2hlcmUgdGhlIHNoZWxsJ3Mgc3RkaW4gYDxgIHJlZGlyZWN0IHRhcmdldFxuICogcmVzb2x2ZXMgXHUyMDE0IGEgcmVkaXJlY3QgaXMgc2hlbGwtc2lkZSwgc28gYGdpdCAtQ2AgbmV2ZXIgYWZmZWN0cyBpdC5cbiAqL1xuZnVuY3Rpb24gZW1pdFBhdGNoVGFyZ2V0cyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGlzR2l0QXBwbHk6IGJvb2xlYW4sXG4gIGhvc3Q6IHN0cmluZyxcbiAgdGFyZ2V0RGlyOiBzdHJpbmcsXG4gIHNoZWxsRGlyOiBzdHJpbmcsXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjsgLy8gcmVhZC1vbmx5IC8gaW5kZXgtb25seSBcdTIwMTQgbm8gdG91Y2hlc1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IHBhdGNoVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyAxLiBBIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChnaXQgYXBwbHkgb25seTsgYSBwYXRjaCBvcGVyYW5kIGlzIGFcbiAgLy8gICAgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSBcdTIwMTQgaWdub3JlZCkuXG4gIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgY29uc3Qgb3BlcmFuZCA9IHBhcnRzLm9wZXJhbmRzLmZpbmQoKG8pID0+IG8gIT09ICctJyk7XG4gICAgaWYgKG9wZXJhbmQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aCh0YXJnZXREaXIsIG9wZXJhbmQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCBmaWxlIHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDIuIFRoZSBzdGRpbiBgPGAgc291cmNlIChwYXRjaCBhbmQgZ2l0IGFwcGx5KS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIGNvbnN0IHN0ZGluID0gcmVkaXJlY3RzLmZpbmQoKHIpID0+IHIub3AgPT09ICc8Jyk7XG4gICAgaWYgKHN0ZGluICE9PSB1bmRlZmluZWQgJiYgc3RkaW4udGFyZ2V0ICE9PSBudWxsKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUoc3RkaW4udGFyZ2V0KSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzdGRpbi50YXJnZXQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aChzaGVsbERpciwgc3RkaW4udGFyZ2V0KTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggdGV4dCB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAzLiBObyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZTogc3RkaW4gaXMgZHluYW1pYyAodGVybWluYWwsIHBpcGUsIHZhcmlhYmxlKS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIGhvc3QsICdubyBzdGF0aWNhbGx5IGtub3duIHBhdGNoIHRleHQgc291cmNlIChzdGRpbiBpcyBkeW5hbWljKScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlID8/IGhvc3QsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCB0YXJnZXREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHBhdGNoL2dpdCBhcHBseSBncmFtbWFyIGluIHRoZSBtYWluIHdhbGs6IGBwYXRjaGAgcmVhZHMgcGF0Y2ggdGV4dCBmcm9tXG4gKiBzdGRpbiBvciBhIGA8YCByZWRpcmVjdDsgYGdpdCBhcHBseWAgYWRkaXRpb25hbGx5IGFjY2VwdHMgYSBwYXRjaC1maWxlXG4gKiBvcGVyYW5kIGFuZCByZXNvbHZlcyB0YXJnZXRzIGFnYWluc3QgaXRzIGAtQ2AgZGlyZWN0b3J5LiBBIHdyYXBwZWRcbiAqIGBwYXRjaGAvYGFwcGx5YCBpcyB1bnJlc29sdmVkIFx1MjAxNCB0aGUgd3JhcHBlciBvYnNjdXJlcyB0aGUgYXJndi5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hQYXRjaEFwcGx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSksXG4gICAgICBmYWxzZSxcbiAgICAgICdwYXRjaCcsXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSksXG4gICAgICB0cnVlLFxuICAgICAgJ2FwcGx5JyxcbiAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3BhdGNoJyB8fCB3cmFwcGVkID09PSAnYXBwbHknKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2MgcGF0Y2gtdGV4dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuNyk6IGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBoZXJlZG9jXG4gKiBib2R5IGlzIHBhdGNoIHRleHQuIFRoZSBvcGVuZXIncyBvd24gb3B0aW9ucyBzdGlsbCBhcHBseSBcdTIwMTQgYC0tZHJ5LXJ1bmAvXG4gKiBgLS1jaGVja2AvYC0tc3RhdGAvYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAvYC0tY2FjaGVkYCBtYWtlIHRoZSBib2R5XG4gKiByZWFkLW9ubHkgKG5vIHRvdWNoZXMpLCBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCwgYW5kIGAtcE5gIHNldHMgdGhlXG4gKiBoZWFkZXIgc3RyaXAgbGV2ZWwuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgYm9keTogc3RyaW5nLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IGlzR2l0QXBwbHkgPSBmYWxzZTtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdO1xuICBsZXQgZGlyID0gY3VycmVudERpcjtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaXNHaXRBcHBseSA9IHRydWU7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGRpciA9IHN1Yi5jRGlyID8/IGN1cnJlbnREaXI7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuO1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UoYm9keSwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdoZXJlZG9jJywgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIGRpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZm9ybWF0dGVyIC8gZml4ZXIgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjgpOiBhIHRhYmxlLWRyaXZlbiBmYW1pbHkgb3ZlciB0aGVcbi8vIGNvcnB1cy1kZXJpdmVkIDE2LXRvb2wgc2V0LiBGbGFnIG1hdGNoaW5nIGlzIGV4YWN0LXRva2VuIG9uIGZ1bGwgYXJndiB3b3JkcyBcdTIwMTRcbi8vIG5ldmVyIHByZWZpeCBvciBzdWJzdHJpbmcgXHUyMDE0IGFuZCB0aGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0LCBzb1xuLy8gYC0tZml4LWRyeS1ydW5gIGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYC0tZml4YCBhbmQgYGJsYWNrIC0tY2hlY2tgIG5ldmVyXG4vLyBoZWFscy4gVG9vbHMgd2hvc2Ugd3JpdGUgZm9ybSBpcyBhIGJhcmUgaW52b2NhdGlvbiAoYmxhY2ssIGlzb3J0LCBydXN0Zm10KVxuLy8gY2FycnkgdGhlIGVtcHR5IGZvcm0gYW5kIGZpcmUgb24gdGhlIHdyaXRlIGZvcm0gaXRzZWxmLiBMZWFkaW5nIHRyYW5zcGFyZW50XG4vLyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVycyAobnB4LCB5YXJuLCBwbnBtIGV4ZWMvZGx4LCBidW54LCBucG0gZXhlYykgc3RyaXBcbi8vIHVuZGVyIGEgcGlubmVkIG9wdGlvbiBncmFtbWFyOyBhIHdyYXBwZXIgdGhhdCBjb3VsZCByZXdyaXRlIGFyZ3YgZmFpbHNcbi8vIGNsb3NlZCBhcyB1bnJlc29sdmVkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBPbmUgXHUwMEE3NS44IHRhYmxlIHJvdzogdGhlIHRvb2wgY29tbWFuZCBhbmQgaXRzIHdyaXRlL3JlYWQtb25seSB0b2tlbiBmb3Jtcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9ybWF0dGVyVG9vbFJvdyB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyB3aG9zZSBleGFjdC10b2tlbiBwcmVzZW5jZSBtYXJrcyB0aGUgaW52b2NhdGlvbiBhIHdyaXRlLiAqL1xuICB3cml0ZUZvcm1zOiBzdHJpbmdbXVtdO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIGNvbnN1bHRlZCBmaXJzdCBcdTIwMTQgcHJlc2VuY2Ugc3VwcHJlc3NlcyB0aGUgd3JpdGUgKHRoZSByZWFkLW9ubHkgbW9kZSB3aW5zKS4gKi9cbiAgcmVhZE9ubHlGb3Jtczogc3RyaW5nW11bXTtcbn1cblxuLyoqXG4gKiBUaGUgXHUwMEE3NS44IHRhYmxlLCBleHBvcnRlZCBzbyB0aGUgY29ycHVzLWNvdmVyYWdlIGZpeHR1cmUgY2FuIGFzc2VydCB0d28tc2lkZWRcbiAqIHRvb2wtc2V0IGVxdWFsaXR5IGFuZCBwZXItdG9vbCByZWFkLW9ubHkgc3VwcHJlc3Npb24gKHBsYW4gXHUwMEE3NS44LCBQaGFzZSAzXG4gKiBzdGVwIDgpLlxuICovXG5leHBvcnQgY29uc3QgRk9STUFUVEVSX1RBQkxFOiByZWFkb25seSBGb3JtYXR0ZXJUb29sUm93W10gPSBbXG4gIHtcbiAgICBjb21tYW5kOiAncHJldHRpZXInLFxuICAgIHdyaXRlRm9ybXM6IFtbJy0td3JpdGUnXSwgWyctdyddXSxcbiAgICByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1saXN0LWRpZmZlcmVudCddLCBbJy0tZGVidWctY2hlY2snXV1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZXNsaW50Jywgd3JpdGVGb3JtczogW1snLS1maXgnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZml4LWRyeS1ydW4nXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdiaW9tZScsXG4gICAgd3JpdGVGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLXdyaXRlJ10sXG4gICAgICBbJ2NoZWNrJywgJy0tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLXdyaXRlJ11cbiAgICBdLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2dvZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1sJ11dIH0sXG4gIHsgY29tbWFuZDogJ2dvaW1wb3J0cycsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbXSB9LFxuICB7IGNvbW1hbmQ6ICdjbGFuZy1mb3JtYXQnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kcnktcnVuJ11dIH0sXG4gIHsgY29tbWFuZDogJ3NoZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ11dIH0sXG4gIHsgY29tbWFuZDogJ3lhcGYnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2F1dG9wZXA4Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2JsYWNrJywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdpc29ydCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2stb25seSddLCBbJy0tZGlmZiddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3J1ZmYnLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2Zvcm1hdCddLCBbJ2NoZWNrJywgJy0tZml4J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS1uby1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0tY2hlY2snXVxuICAgIF1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZGVubycsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snZm10JywgJy0tY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAnZHByaW50Jywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydjaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdydXN0Zm10Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZW1pdCcsICdzdGRvdXQnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICd0ZXJyYWZvcm0nLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2ZtdCcsICctY2hlY2snXSxcbiAgICAgIFsnZm10JywgJy1kaWZmJ11cbiAgICBdXG4gIH1cbl07XG5cbi8qKiBUaGUgcGlubmVkIHBhY2thZ2UtcnVubmVyIG5vLWFyZyBmbGFncyAocGxhbiBcdTAwQTc1LjgpOiBmbGFncyB0aGF0IGNhbm5vdCBtb3ZlIG9yIHJld3JpdGUgYXJndi4gKi9cbmNvbnN0IFJVTk5FUl9OT19BUkdfRkxBR1MgPSBuZXcgU2V0KFsnLXknLCAnLS15ZXMnLCAnLS1uby1pbnN0YWxsJ10pO1xuXG4vKiogVGhlIG91dGNvbWUgb2Ygc3RyaXBwaW5nIG9uZSBsZWFkaW5nIHBhY2thZ2UtcnVubmVyIHdyYXBwZXIuICovXG50eXBlIFJ1bm5lclN0cmlwID0geyBraW5kOiAnc3RyaXBwZWQnOyBzdHJpcHBlZDogc3RyaW5nW10gfSB8IHsga2luZDogJ29ic2N1cmVkJyB9O1xuXG4vKipcbiAqIFN0cmlwIG9uZSBsZWFkaW5nIHRyYW5zcGFyZW50IHBhY2thZ2UtcnVubmVyIHdyYXBwZXIgKHBsYW4gXHUwMEE3NS44KTogYG5weGAsXG4gKiBgeWFybmAsIGBwbnBtIGV4ZWNgL2BwbnBtIGRseGAsIGBidW54YCwgYW5kIGBucG0gZXhlY2AgZm9sbG93ZWQgZGlyZWN0bHkgYnlcbiAqIHRoZSB3cmFwcGVkIGNvbW1hbmQgd29yZCwgd2l0aCBvbmx5IHRoZSBwaW5uZWQgbm8tYXJnIGZsYWdzIChgLXlgL2AtLXllc2AsXG4gKiBgLS1uby1pbnN0YWxsYCkgYW5kIGBucG0gZXhlY2AncyBgLS1gIHRlcm1pbmF0b3IgYmV0d2Vlbi4gQSBzdHJpbmctZm9ybVxuICogYXJndW1lbnQgKGBucHggXCJwcmV0dGllciAtLXdyaXRlIGZcImApLCBhbiBhcmd2LWFsdGVyaW5nIHJ1bm5lciBmbGFnXG4gKiAoYC0tcGFja2FnZT1YYCBvciBhIGZsYWcgY29uc3VtaW5nIHRoZSBuZXh0IHdvcmQpLCBvciBhIHdyYXBwZXIgd29yZCB0aGF0IGlzXG4gKiBpdHNlbGYgYSBzY3JpcHQgKGAuYC1wcmVmaXhlZCkgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndiBcdTIwMTQgdGhlIHdyYXBwZXIgaXNcbiAqIHRyYW5zcGFyZW50IG9ubHkgd2hlbiB0aGUgcGlubmVkIGdyYW1tYXIgcHJvdmVzIGl0IHNvLiBSZXR1cm5zICdub3QtcnVubmVyJ1xuICogd2hlbiB0aGUgd29yZCBpcyBub3QgYSBydW5uZXIgYXQgYWxsIChhIGRpZmZlcmVudCBucG0vcG5wbSBzdWJjb21tYW5kLCBvciBhXG4gKiBiYXJlIHJ1bm5lciB3aXRoIG5vIGNvbW1hbmQgd29yZCkgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LCB3aGljaFxuICogZmFpbHMgY2xvc2VkIGZvciBub24tZm9ybWF0dGVyIHJ1bm5lcnMuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwUGFja2FnZVJ1bm5lcihhcmd2OiBzdHJpbmdbXSk6IFJ1bm5lclN0cmlwIHwgJ25vdC1ydW5uZXInIHtcbiAgY29uc3QgcnVubmVyID0gYXJndlswXTtcbiAgbGV0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnB4JyB8fCBydW5uZXIgPT09ICd5YXJuJyB8fCBydW5uZXIgPT09ICdidW54Jykge1xuICAgIC8vIFRoZXNlIHJ1bm5lcnMgdGFrZSB0aGUgY29tbWFuZCB3b3JkIGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ3BucG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJyAmJiByZXN0WzBdICE9PSAnZGx4JykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICducG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gJ25vdC1ydW5uZXInO1xuICB9XG4gIHdoaWxlIChSVU5ORVJfTk9fQVJHX0ZMQUdTLmhhcyhyZXN0WzBdKSkgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducG0nICYmIHJlc3RbMF0gPT09ICctLScpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybiAnbm90LXJ1bm5lcic7IC8vIGEgYmFyZSBydW5uZXIgYXR0cmlidXRlcyBub3RoaW5nXG4gIGNvbnN0IHdyYXBwZWQgPSByZXN0WzBdO1xuICBpZiAod3JhcHBlZC5zdGFydHNXaXRoKCctJykgfHwgd3JhcHBlZC5zdGFydHNXaXRoKCcuJykgfHwgL1xccy8udGVzdCh3cmFwcGVkKSkgcmV0dXJuIHsga2luZDogJ29ic2N1cmVkJyB9O1xuICByZXR1cm4geyBraW5kOiAnc3RyaXBwZWQnLCBzdHJpcHBlZDogcmVzdCB9O1xufVxuXG4vKipcbiAqIFRoZSBmb3JtYXR0ZXIvZml4ZXIgZmFtaWx5IChwbGFuIFx1MDBBNzUuOCkuIFRoZSByZWFkLW9ubHkgZm9ybXMgYXJlIGNvbnN1bHRlZFxuICogZmlyc3QgYW5kIHdpbiBvdmVyIGFueSB3cml0ZSBmb3JtOyBhIHdyaXRlIGZvcm0gd2l0aCBubyByZWFkLW9ubHkgZm9ybSBhbmRcbiAqIGV2ZXJ5IG9wZXJhbmQgYW4gZXhwbGljaXQgZmlsZSBlbWl0cyBhIHdob2xlLWZpbGUgYG1vZGlmeWAgcGVyIG9wZXJhbmQ7XG4gKiBkaXJlY3RvcnkvZ2xvYi9uby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmc7IHVua25vd24gZXhlY3V0YWJsZXNcbiAqIGZhaWwgY2xvc2VkLiBBIGZvcm0ncyBsZWFkaW5nIHN1YmNvbW1hbmQgd29yZCAoYGNoZWNrYC9gZm9ybWF0YC9gZm10YCkgaXNcbiAqIHBvc2l0aW9uYWwgXHUyMDE0IGl0IG11c3QgbGVhZCB0aGUgdG9vbCdzIGFyZ3MsIHNvIGBkZW5vIHRhc2sgZm10YCBpcyBhIHNjcmlwdFxuICogcnVubmVyLCBub3QgYSBmb3JtYXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoRm9ybWF0dGVyKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgbGV0IHdvcmRzID0gcmVzdDtcbiAgY29uc3Qgc3RyaXAgPSBzdHJpcFBhY2thZ2VSdW5uZXIocmVzdCk7XG4gIGlmIChzdHJpcCA9PT0gJ25vdC1ydW5uZXInKSB7XG4gICAgLy8gcmVzdFswXSBpcyBub3QgYSBwYWNrYWdlIHJ1bm5lciBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAoc3RyaXAua2luZCA9PT0gJ29ic2N1cmVkJykge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCByZXN0WzBdLCBgdGhlICR7cmVzdFswXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2YCk7XG4gICAgcmV0dXJuO1xuICB9IGVsc2Uge1xuICAgIHdvcmRzID0gc3RyaXAuc3RyaXBwZWQ7XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKHdvcmRzWzBdKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSB3b3Jkc1sxXTtcbiAgICBpZiAod3JhcHBlZCAhPT0gdW5kZWZpbmVkICYmIEZPUk1BVFRFUl9UQUJMRS5zb21lKChyKSA9PiByLmNvbW1hbmQgPT09IHdyYXBwZWQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke3dvcmRzWzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvdyA9IEZPUk1BVFRFUl9UQUJMRS5maW5kKChyKSA9PiByLmNvbW1hbmQgPT09IHdvcmRzWzBdKTtcbiAgaWYgKHJvdyA9PT0gdW5kZWZpbmVkKSByZXR1cm47IC8vIHVua25vd24gZXhlY3V0YWJsZSBcdTIwMTQgZmFpbCBjbG9zZWQsIG5vIHRvdWNoXG4gIGNvbnN0IGFyZ3MgPSB3b3Jkcy5zbGljZSgxKTtcbiAgY29uc3QgZm9ybVByZXNlbnQgPSAoZm9ybTogc3RyaW5nW10pOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBmaXJzdCA9IGZvcm1bMF07XG4gICAgaWYgKGZpcnN0ICE9PSB1bmRlZmluZWQgJiYgIWZpcnN0LnN0YXJ0c1dpdGgoJy0nKSAmJiBhcmdzWzBdICE9PSBmaXJzdCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBmb3JtLmV2ZXJ5KCh0b2tlbikgPT4gYXJncy5pbmNsdWRlcyh0b2tlbikpO1xuICB9O1xuICAvLyBUaGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0IGFuZCB3aW5zIG92ZXIgYW55IHdyaXRlIGZvcm06XG4gIC8vIGBlc2xpbnQgLS1maXggLS1maXgtZHJ5LXJ1biBmYCB3cml0ZXMgbm90aGluZywgYGJsYWNrIC0tY2hlY2sgZmAgbmV2ZXIgaGVhbHMuXG4gIGlmIChyb3cucmVhZE9ubHlGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuO1xuICBpZiAoIXJvdy53cml0ZUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47IC8vIGJhcmUgaW52b2NhdGlvbnMgb2YgZmxhZy1yZXF1aXJlZCB0b29scyBhcmUgcmVhZC1vbmx5IChzdGRvdXQvbGludClcbiAgLy8gQ29uc3VtZSB0aGUgdG9vbCdzIHN1YmNvbW1hbmQgd29yZCBiZWZvcmUgY29sbGVjdGluZyBvcGVyYW5kcy5cbiAgY29uc3Qgc3ViY29tbWFuZFdvcmRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgZm9ybSBvZiByb3cud3JpdGVGb3Jtcykge1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgZm9ybSkge1xuICAgICAgaWYgKCF0b2tlbi5zdGFydHNXaXRoKCctJykpIHN1YmNvbW1hbmRXb3Jkcy5hZGQodG9rZW4pO1xuICAgIH1cbiAgfVxuICBjb25zdCBhZnRlclN1YmNvbW1hbmQgPSBzdWJjb21tYW5kV29yZHMuaGFzKGFyZ3NbMF0pID8gYXJncy5zbGljZSgxKSA6IGFyZ3M7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYWZ0ZXJTdWJjb21tYW5kKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoc2hhcmVkIFx1MDBBNzUpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAob3BlcmFuZHMubGVuZ3RoID09PSAwKSByZXR1cm47IC8vIG5vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZ1xuICAvLyBFdmVyeSBvcGVyYW5kIG11c3QgYmUgYW4gZXhwbGljaXQgZmlsZSBcdTIwMTQgYSBnbG9iLCB2YXJpYWJsZSwgZGlyZWN0b3J5LCBvclxuICAvLyB0cmFpbGluZy1zbGFzaCBvcGVyYW5kIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZC5cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSkpIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdmb3JtYXR0ZXItd3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KSwgdGhlIGxhc3QgcHVyZS1wYXJzZXJcbi8vIGZhbWlseS4gUmVzdG9yZSBoYXMgbm8gcmV2aXNpb24gb3BlcmFuZCBmb3JtIFx1MjAxNCBpdHMgcG9zaXRpb25hbCBhcmdzIGFyZVxuLy8gYWx3YXlzIHBhdGhzcGVjczsgY2hlY2tvdXQgc2tpcHMgYSBwcmUtYC0tYCByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgdGFrZXNcbi8vIHBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuIEV2ZXJ5IGV4cGxpY2l0LWZpbGUgcGF0aHNwZWMgaXMgYSB3aG9sZS1maWxlXG4vLyBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgKGAuYC9gLi5gLCB0cmFpbGluZyBgL2AsXG4vLyBvciBhIHBhdGggdGhhdCBzdGF0cyBhcyBhIGRpcmVjdG9yeSksIGAtLXN0YWdlZGAtb25seSByZXN0b3JlLCBhbmRcbi8vIGAtcGAvYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGFsbCBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogZ2l0IHJlc3RvcmUgbm8tdmFsdWUgZmxhZ3MgKHBsYW4gXHUwMEE3NS45KTsgYC1zYC9gLS1zb3VyY2VgLCBgLS1zdGFnZWRgLCBgLVdgL2AtLXdvcmt0cmVlYCwgYC1tYC9gLS1tZXJnZWAsIGFuZCBgLXBgL2AtLXBhdGNoYCBhcmUgaGFuZGxlZCBleHBsaWNpdGx5LiAqL1xuY29uc3QgUkVTVE9SRV9OT19WQUxVRSA9IG5ldyBTZXQoWyctcScsICctZicsICctdSddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJlc3RvcmUvY2hlY2tvdXQgcGF0aHNwZWMgZW1pc3Npb24gKHBsYW4gXHUwMEE3NS45KTogYW4gZXhwbGljaXQtZmlsZVxuICogcGF0aHNwZWMgKG5vIGdsb2JzLCBubyBgLmAvYC4uYCwgbm8gZGlyZWN0b3J5LCBubyB0cmFpbGluZyBgL2ApIGlzIGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgd2hvbGUtZmlsZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIGlzXG4gKiB1bnJlc29sdmVkIFx1MjAxNCBhIGRpcmVjdG9yeSByZXN0b3JlL2NoZWNrb3V0IHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoXG4gKiBpdCBhbmQgY2Fubm90IGJlIGF0dHJpYnV0ZWQgdG8gYSBmaWxlIHdyaXRlLlxuICovXG5mdW5jdGlvbiBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMoXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBpZGlvbTogJ2dpdC1yZXN0b3JlLXdyaXRlJyB8ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICBvcGVyYW5kOiBzdHJpbmcsXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBpZGlvbSwgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCk7XG4gIGlmIChvcGVyYW5kID09PSAnLicgfHwgb3BlcmFuZCA9PT0gJy4uJyB8fCBvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICByZXN1bHRzLFxuICAgICAgaWRpb20sXG4gICAgICBvcGVyYW5kLFxuICAgICAgJ2RpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGggaXQgXHUyMDE0IG5vdCBhdHRyaWJ1dGFibGUgdG8gYSBmaWxlIHdyaXRlJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tLFxuICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLXNgL2AtLXNvdXJjZT08dHJlZT5gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSB0cmVlIG9wZXJhbmQgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9gLS1wYXRjaGBcbiAqIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGAtbWAvYC0tbWVyZ2VgICh0aGUgbWVyZ2VcbiAqIG1hY2hpbmVyeSwgY29uZGl0aW9uYWwgb24gdGhlIGluZGV4IGJlaW5nIHVubWVyZ2VkKSBhbmQgYC0tc3RhZ2VkYCB3aXRob3V0XG4gKiBgLS13b3JrdHJlZWAgKGluZGV4LW9ubHkgXHUyMDE0IHRoZSB3b3JraW5nIGZpbGUgc3Vydml2ZXMpIHRvdWNoIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVzdG9yZU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3RhZ2VkID0gZmFsc2U7XG4gIGxldCB3b3JrdHJlZSA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtcmVzdG9yZS13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycgfHwgYSA9PT0gJy0tc291cmNlJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgdHJlZSBvcGVyYW5kIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXNvdXJjZT0nKSkgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbScgfHwgYSA9PT0gJy0tbWVyZ2UnKSByZXR1cm47XG4gICAgaWYgKGEgPT09ICctLXN0YWdlZCcpIHtcbiAgICAgIHN0YWdlZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctVycgfHwgYSA9PT0gJy0td29ya3RyZWUnKSB7XG4gICAgICB3b3JrdHJlZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFJFU1RPUkVfTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKHN0YWdlZCAmJiAhd29ya3RyZWUpIHJldHVybjsgLy8gaW5kZXgtb25seSByZXN0b3JlIGRvZXMgbm90IHRvdWNoIHRoZSB3b3JraW5nIGZpbGVcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtcmVzdG9yZS13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgY2hlY2tvdXQgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtYmAvYC1CYC9gLS1vcnBoYW4gPGJyYW5jaD5gXG4gKiBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgYnJhbmNoIG5hbWUgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9cbiAqIGAtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBhIHByZS1gLS1gIHBvc2l0aW9uYWwgaXNcbiAqIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIGlzIHNraXBwZWQuIFBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1iJyB8fCBhID09PSAnLUInIHx8IGEgPT09ICctLW9ycGhhbicpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIGJyYW5jaCBuYW1lIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLXEnIHx8IGEgPT09ICctbScgfHwgYSA9PT0gJy10JykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICAvLyBBIHByZS1gLS1gIHBvc2l0aW9uYWwgaXMgYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBcdTIwMTQgbmV2ZXIgYSBwYXRoc3BlYy5cbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1jaGVja291dC13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBmYW1pbHkgKHBsYW4gXHUwMEE3NS45KTogdmlhIGBmaW5kR2l0U3ViY29tbWFuZGBcbiAqIChoYW5kbGVzIGBnaXQgLUNgL2AtY2ApLCB0aGUgdHdvIHN1YmNvbW1hbmRzIHJlc29sdmUgdGhlaXIgcGF0aHNwZWNzIHRvXG4gKiB3aG9sZS1maWxlIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgYSB3cmFwcGVkIHN1YmNvbW1hbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBtYXRjaEdpdFJlc3RvcmVDaGVja291dChcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IChzdWIuc3ViY29tbWFuZCAhPT0gJ3Jlc3RvcmUnICYmIHN1Yi5zdWJjb21tYW5kICE9PSAnY2hlY2tvdXQnKSkgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kLFxuICAgICAgICAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGlyID0gc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbjtcbiAgICBjb25zdCBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScpIG1hdGNoUmVzdG9yZU9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICBlbHNlIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncmVzdG9yZScgfHwgd3JhcHBlZCA9PT0gJ2NoZWNrb3V0Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHdyYXBwZWQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgTElORV9TRUxFQ1RPUlMgPSBbbWF0Y2hTZWQsIG1hdGNoSGVhZCwgbWF0Y2hUYWlsXTtcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogU3Bhbk1hdGNoW10ge1xuICBjb25zdCB7IHdyaXRlczogaGVyZWRvY1dyaXRlcywgbWFza2VkIH0gPSBleHRyYWN0SGVyZWRvY1dyaXRlcyhjb21tYW5kKTtcbiAgY29uc3Qgc2ltcGxlQ29tbWFuZHMgPSBzcGxpdFRvcExldmVsKG1hc2tlZCk7XG5cbiAgY29uc3QgcmVzdWx0czogU3Bhbk1hdGNoW10gPSBbXTtcbiAgY29uc3QgZnNMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcbiAgY29uc3QgZ2l0TGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG5cbiAgY29uc3QgY2FjaGVkRnNUb3RhbExpbmVzID0gKGFic1BhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGlmICghZnNMaW5lQ2FjaGUuaGFzKGFic1BhdGgpKSBmc0xpbmVDYWNoZS5zZXQoYWJzUGF0aCwgY291bnRGaWxlTGluZXMoYWJzUGF0aCkpO1xuICAgIHJldHVybiBmc0xpbmVDYWNoZS5nZXQoYWJzUGF0aCkgPz8gbnVsbDtcbiAgfTtcbiAgY29uc3QgY2FjaGVkR2l0VG90YWxMaW5lcyA9IChnaXRDd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGAke2dpdEN3ZH1cdTAwMDAke3Jldn1cdTAwMDAke3BhdGh9YDtcbiAgICBpZiAoIWdpdExpbmVDYWNoZS5oYXMoa2V5KSkgZ2l0TGluZUNhY2hlLnNldChrZXksIGNvdW50R2l0QmxvYkxpbmVzKGdpdEN3ZCwgcmV2LCBwYXRoKSk7XG4gICAgcmV0dXJuIGdpdExpbmVDYWNoZS5nZXQoa2V5KSA/PyBudWxsO1xuICB9O1xuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgbGFzdFBsYWluRmlsZVNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIFRoZSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKHBsYW4gXHUwMEE3NS4yKTogc2V0IGF0IHRoZSBlbmQgb2ZcbiAgLy8gZWFjaCBzaW1wbGUgY29tbWFuZCwgY2xlYXJlZCBhdCBhbnkgbm9uLXBpcGUgYm91bmRhcnksIHRocmVhZGVkIGJ5IHRlZSAtYVxuICAvLyBhcHBlbmRzIGluIHRoZSBuZXh0IHBpcGUgc3RhZ2UgKGBlY2hvIHggfCB0ZWUgLWEgZmApLlxuICBsZXQgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAvKiogVGhlIGBqb2luYCBzdGFtcCBmb3IgYSBzaW1wbGUgY29tbWFuZDogb25seSB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBjb25zdCBqb2luT2YgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kKTogUmVzb2x2ZWRTcGFuWydqb2luJ10gPT5cbiAgICBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJyYmJyB8fCBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ3x8JyA/IHNpbXBsZS5wcmVjZWRlZEJ5IDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoXG4gICAgYzogUmF3Q2FuZGlkYXRlLFxuICAgIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuICApID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWxMaW5lcyA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhjLmRpck92ZXJyaWRlID8/IGRpckZvclJlc29sdXRpb24sIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW5cbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvKipcbiAgICogVGhlIHJlYWQgaWRpb21zIGZvciBvbmUgc2ltcGxlIGNvbW1hbmQgKHRoZSBleGlzdGluZyBjb3JwdXMgZ3JhbW1hcik6XG4gICAqIHBsYWluIGBjYXRgL2BubGAgc291cmNlcywgdGhlIGxpbmUgc2VsZWN0b3JzLCBhbmQgdGhlIGdpdCBtYXRjaGVycywgd2l0aFxuICAgKiBvbmUtaG9wIHBpcGUtc291cmNlIHByb3BhZ2F0aW9uIGZvciBkb3duc3RyZWFtIGBoZWFkYC9gdGFpbGAvYHNlZCAtbmAuXG4gICAqL1xuICBjb25zdCBtYXRjaFJlYWRzID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10sIGk6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGxldCBpc1BsYWluU291cmNlID0gZmFsc2U7XG4gICAgbGV0IHBsYWluRmlsZUFyZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnICYmIGFyZ3YubGVuZ3RoID09PSAyICYmICFhcmd2WzFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBwbGFpbkZpbGVBcmcgPSBhcmd2WzFdO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGFyZ3ZbMV0pID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGFyZ3ZbMV0pO1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ25sJyAmJiBhcmd2Lmxlbmd0aCA+PSAyICYmICFhcmd2W2FyZ3YubGVuZ3RoIC0gMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IGYgPSBhcmd2W2FyZ3YubGVuZ3RoIC0gMV07XG4gICAgICBwbGFpbkZpbGVBcmcgPSBmO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGYpID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGYpO1xuICAgIH1cblxuICAgIC8vIEEgYmFyZSBgY2F0IGZpbGVgL2BubCBmaWxlYCB0aGF0IGlzIG5vdCBmZWVkaW5nIGEgZG93bnN0cmVhbSBwaXBlIHN0YWdlXG4gICAgLy8gcmVhZHMgdGhlIHdob2xlIGZpbGU6IGVtaXQgdGhlIHNhbWUgd2hvbGUtZmlsZSBzcGFuIGBnaXQgc2hvdyByZXY6cGF0aGBcbiAgICAvLyBwcm9kdWNlcy4gV2hlbiBhIHBpcGUgZm9sbG93cywgdGhlIGRvd25zdHJlYW0gbGluZS1zZWxlY3RvciBhbHJlYWR5XG4gICAgLy8gZW1pdHMgdGhlIHByZWNpc2UgcmFuZ2UsIHNvIHRoZSBzb3VyY2Ugc3RheXMgc291cmNlLW9ubHkuXG4gICAgaWYgKHBsYWluRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbmV4dCA9IHNpbXBsZUNvbW1hbmRzW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dC5wcmVjZWRlZEJ5ICE9PSAnfCcpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICAgIGlkaW9tOiBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZScsXG4gICAgICAgICAgICBmaWxlQXJnOiBwbGFpbkZpbGVBcmcsXG4gICAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICAgICAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgICAgICAgICB9LFxuICAgICAgICAgIGN1cnJlbnREaXIsXG4gICAgICAgICAgaSxcbiAgICAgICAgICBqb2luT2Yoc2ltcGxlKVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIFsuLi5MSU5FX1NFTEVDVE9SUywgbWF0Y2hHaXRTaG93LCBtYXRjaEdpdExvZ0xdKSB7XG4gICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcihhcmd2KSkge1xuICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICAvLyBgZ2l0IHNob3cgcmV2OnBhdGhgIHByaW50cyB0aGUgYmxvYiB2ZXJiYXRpbSwgc28gKHVubGlrZSBgZ2l0IGxvZyAtTGAsXG4gICAgICAgICAgLy8gd2hpY2ggcHJpbnRzIGRpZmYtZm9ybWF0dGVkIGhpc3RvcnkpIGl0J3MgYSB2YWxpZCBvbmUtaG9wIHBpcGUgc291cmNlXG4gICAgICAgICAgLy8gZm9yIGEgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yLCBzYW1lIGFzIGBjYXRgL2BubGAuXG4gICAgICAgICAgaWYgKG91dGNvbWUuaWRpb20gPT09ICdnaXQtc2hvdy1yZXYtcGF0aCcgJiYgIWxvb2tzVW5yZXNvbHZhYmxlKG91dGNvbWUuZmlsZUFyZykpIHtcbiAgICAgICAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IHJlc29sdmVQYXRoKG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgb3V0Y29tZS5maWxlQXJnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoZWQgJiYgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8JyAmJiBsYXN0UGxhaW5GaWxlU291cmNlKSB7XG4gICAgICBjb25zdCB3aXRoRmlsZSA9IFsuLi5hcmd2LCBsYXN0UGxhaW5GaWxlU291cmNlXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBMSU5FX1NFTEVDVE9SUykge1xuICAgICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcih3aXRoRmlsZSkpIHtcbiAgICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAnY2FuZGlkYXRlJykgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluU291cmNlKSBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNpbXBsZUNvbW1hbmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gc2ltcGxlQ29tbWFuZHNbaV07XG5cbiAgICAvLyBBIHBpcGUgc3RhZ2UgbWF5IGluaGVyaXQgdGhlIHByZXZpb3VzIHN0YWdlJ3MgbGl0ZXJhbCBlY2hvIGNvbnRlbnQ7IGFueVxuICAgIC8vIG90aGVyIGJvdW5kYXJ5IGNsZWFycyBpdC5cbiAgICBpZiAoc2ltcGxlLnByZWNlZGVkQnkgIT09ICd8JykgcGlwZUVjaG9Db250ZW50ID0gbnVsbDtcblxuICAgIGNvbnN0IGhlcmVkb2NSZWYgPSBzaW1wbGUudGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgY29uc3QgdyA9IGhlcmVkb2NXcml0ZXNbTnVtYmVyLnBhcnNlSW50KGhlcmVkb2NSZWZbMV0sIDEwKV07XG4gICAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyh3Lm9wZW5lcikudHJpbSgpKTtcbiAgICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgb3BlbmVyQXJndiA9IGFuYWx5emVUb2tlbnModG9rZW5zKS5hcmd2O1xuICAgICAgbWF0Y2hSZWFkcyhzaW1wbGUsIG9wZW5lckFyZ3YsIGkpO1xuICAgICAgY2xhc3NpZnlIZXJlZG9jT3BlbmVyKHcub3BlbmVyLCB3LmJvZHksIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KG9wZW5lckFyZ3YpID8/IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGUudGV4dCkudHJpbSgpKTtcbiAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB7IGFyZ3YsIHJlZGlyZWN0cyB9ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpO1xuICAgIGlmIChhcmd2Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQmFyZSBgPiBmYCAvIGA6ID4gZmA6IG5vIGFyZ3YsIGJ1dCB0aGUgdHJ1bmNhdGlvbiBncmFtbWFyIHN0aWxsIGZpcmVzLlxuICAgICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoYXJndlswXSA9PT0gJ2NkJykge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb25zdCB0YXJnZXQgPSBhcmd2WzFdO1xuICAgICAgaWYgKHRhcmdldCAhPT0gdW5kZWZpbmVkICYmIHRhcmdldCAhPT0gJy0nICYmICFoYXNTaGVsbEV4cGFuc2lvbih0YXJnZXQpKSB7XG4gICAgICAgIGN1cnJlbnREaXIgPSByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgbWF0Y2hSZWFkcyhzaW1wbGUsIGFyZ3YsIGkpO1xuICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaENvcHlNb3ZlRmFtaWx5KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFJtVHJ1bmNhdGUoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoU2VkSW5wbGFjZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hQYXRjaEFwcGx5KGFyZ3YsIHJlZGlyZWN0cywgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoRm9ybWF0dGVyKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEdpdFJlc3RvcmVDaGVja291dChhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQoYXJndikgPz8gbnVsbDtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIGBjd2RgIGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCBcdTIwMTQgcGFzcyB0aGUgaG9vaydzIG93biBgY3dkYCBmaWVsZCBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqXG4gKiBUaGUgd29yZC1sZXZlbCB0b2tlbml6ZXIgKFt0b2tlbml6ZV0pIGlzIHF1b3RlLSBhbmQgcmVkaXJlY3QtYXdhcmUgKHBsYW5cbiAqIFx1MDBBNzUuMTApOiByZWRpcmVjdCBvcGVyYXRvcnMgYXJlIHNwbGl0IGFzIGRpc3RpbmN0IHRva2VucyB3aXRoIGF0dGFjaGVkLXRhcmdldFxuICogZm9ybXMgcHJlc2VydmVkIChgPmZgKSwgcXVvdGVkIHRva2VucyBhcmUgd29yZHMgYW5kIG5ldmVyIG9wZXJhdG9ycywgYW5kXG4gKiBbYXJndk9mXSBkZXJpdmVzIG9wZXJhbmRzIGZyb20gdGhlIHRva2VuIHN0cmVhbSBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kXG4gKiB0aGVpciB0YXJnZXRzLlxuICovXG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZDogJ3wnIGZvciBhIHBpcGVsaW5lIHN0YWdlLFxuICAgKiAnJiYnLyd8fCcgZm9yIHRoZSBjb25kaXRpb25hbCBvcGVyYXRvcnMgKHRoZSBvbmx5IG9uZXMgdGhhdCBnYXRlLCBwbGFuXG4gICAqIFx1MDBBNzMgc3RlcCAyKSwgJ290aGVyJyBmb3IgJzsnL25ld2xpbmUvJyYnLCBvciAnc3RhcnQnIGZvciB0aGUgZmlyc3QgY29tbWFuZC5cbiAgICovXG4gIHByZWNlZGVkQnk6ICdzdGFydCcgfCAnfCcgfCAnJiYnIHwgJ3x8JyB8ICdvdGhlcic7XG59XG5cbi8qKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LCA7LCB8LCB8JiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmUgcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU2ltcGxlQ29tbWFuZFtdIHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddID0gJ3N0YXJ0JztcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSkgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgb3BlcmF0b3IgY3VycmVudGx5IHBlbmRpbmcgaXMgYSBwaXBlIChgfGAvYHwmYCkuIEEgaGVscGVyXG4gICAqIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3MgY29udHJvbC1mbG93IG5hcnJvd2luZ1xuICAgKiBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0c1xuICAgKiBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGUgZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlXG4gICAqIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzUGVuZGluZ1BpcGUgPSAoKTogYm9vbGVhbiA9PiBwZW5kaW5nT3AgPT09ICd8JztcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICBmbHVzaCgnJiYnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgIGZsdXNoKCd8fCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgLy8gQSBuZXdsaW5lIGltbWVkaWF0ZWx5IGFmdGVyIGEgcGlwZSBvcGVyYXRvciBpcyBhIGxpbmUgY29udGludWF0aW9uXG4gICAgICAgIC8vIChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCBrZWVwcyB0aGUgcGlwZWxpbmUpLCBub3QgYSBzdGF0ZW1lbnRcbiAgICAgICAgLy8gc2VwYXJhdG9yOiBza2lwcGluZyBpdCBwcmVzZXJ2ZXMgYHByZWNlZGVkQnk6ICd8J2AgZm9yIHRoZSBuZXh0XG4gICAgICAgIC8vIHN0YWdlIGluc3RlYWQgb2YgZGVncmFkaW5nIGl0IHRvICdvdGhlcicuXG4gICAgICAgIGlmIChpc1BlbmRpbmdQaXBlKCkpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgIC8vIGAmPmAvYCY+PmAgKHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QpIGFuZCBgPiZgIChmZC1kdXAgcmVkaXJlY3QsIGFzIGluXG4gICAgICAgIC8vIGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90IGNvbW1hbmQgc2VwYXJhdG9ycyBcdTIwMTQga2VlcCB0aGVtXG4gICAgICAgIC8vIGluIHRoZSBjdXJyZW50IHNpbXBsZSBjb21tYW5kIHNvIHRoZSB0b2tlbml6ZXIgY2FuIGxleCB0aGVtIGFzIG9uZVxuICAgICAgICAvLyB0b2tlbi4gQSBgPmAgY291bnRzIGFzIGEgZHVwLXJlZGlyZWN0IHByZWZpeCBvbmx5IGF0IGEgdG9rZW5cbiAgICAgICAgLy8gYm91bmRhcnkgKHN0YXJ0LCBvciBhZnRlciB3aGl0ZXNwYWNlL2RpZ2l0cykgXHUyMDE0IGBhPmImY2Agc3RpbGxcbiAgICAgICAgLy8gYmFja2dyb3VuZHMgdGhlIGBhPmJgIHJlZGlyZWN0LlxuICAgICAgICBjb25zdCB0cmltbWVkID0gYnVmLnRyaW1FbmQoKTtcbiAgICAgICAgbGV0IGR1cFJlZGlyZWN0ID0gZmFsc2U7XG4gICAgICAgIGlmICh0cmltbWVkLmVuZHNXaXRoKCc+JykpIHtcbiAgICAgICAgICBjb25zdCBiZWZvcmUgPSB0cmltbWVkLmxlbmd0aCA+PSAyID8gdHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdIDogJyc7XG4gICAgICAgICAgZHVwUmVkaXJlY3QgPSB0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdChiZWZvcmUpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWRbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaCgnb3RoZXInKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5jb25zdCBMRUFESU5HX0FTU0lHTk1FTlQgPSAvXig/OltBLVphLXpfXVtBLVphLXowLTlfXSo9XFxTKlxccyspKy87XG5cbi8qKiBTdHJpcCBsZWFkaW5nIEZPTz1iYXIgVkFSPWJheiBlbnYtcHJlZml4IGFzc2lnbm1lbnRzIGZyb20gYSBzaW1wbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzaW1wbGVDbWQucmVwbGFjZShMRUFESU5HX0FTU0lHTk1FTlQsICcnKTtcbn1cblxuLyoqIE9uZSBxdW90ZS1hd2FyZSBsZXhpY2FsIHRva2VuIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIHRleHQgKHBsYW4gXHUwMEE3NS4xMCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuIHtcbiAgLyoqXG4gICAqIFRoZSB0b2tlbiB0ZXh0LiBXb3JkIHRva2VucyBoYXZlIHF1b3RlcyBzdHJpcHBlZCBhbmQgZXNjYXBlcyByZXNvbHZlZDtcbiAgICogcmVkaXJlY3QgdG9rZW5zIGtlZXAgdGhlIG9wZXJhdG9yIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCAoYD5mYCxcbiAgICogYD4+ZmApLCBzaGVsbC1sZXhlciBzdHlsZS5cbiAgICovXG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIHdhcyBxdW90ZWQgb3IgZXNjYXBlZCBhbnl3aGVyZSBpbiB0aGUgc291cmNlLiBBIHF1b3RlZFxuICAgKiB0b2tlbiBpcyBhIHdvcmQsIG5ldmVyIGFuIG9wZXJhdG9yIChgZWNobyAnPidgIGlzIG5vdCBhIHJlZGlyZWN0KS5cbiAgICovXG4gIHF1b3RlZDogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgKGA+YCwgYD4+YCwgYDE+YCwgYDI+YCwgYCY+YCxcbiAgICogYCY+PmAsIGA+JmAsIGA8YCwgYDw8YCwgYDw8LWAsIGA8PDxgKSwgd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IHByZXNlcnZlZFxuICAgKiBpbiBgdGV4dGAuXG4gICAqL1xuICBpc1JlZGlyZWN0OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFF1b3RlLWF3YXJlIHRva2VuaXplciB0aGF0IHNwbGl0cyByZWRpcmVjdCBvcGVyYXRvcnMgYXMgZGlzdGluY3QgdG9rZW5zIHdpdGhcbiAqIGF0dGFjaGVkLXRhcmdldCBmb3JtcyBwcmVzZXJ2ZWQgKHBsYW4gXHUwMEE3NS4xMCkuIFdvcmQgdG9rZW5zIGNhcnJ5IHRoZVxuICogYHF1b3RlZGAgZmxhZyBzbyBjb25zdW1lcnMgY2FuIHRlbGwgYSByZWFsIGA8PGAgb3BlcmF0b3IgZnJvbSBhIHF1b3RlZFxuICogYFwiPDxcImAgbGl0ZXJhbC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5pemUoczogc3RyaW5nKTogVG9rZW5bXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnM6IFRva2VuW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgcXVvdGVkID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIGNvbnN0IGZsdXNoV29yZCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoYnVmLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmLCBxdW90ZWQsIGlzUmVkaXJlY3Q6IGZhbHNlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHVucXVvdGVkIGNvbnRlbnQgb2YgdGhlIHF1b3RlZCBzZWN0aW9uIG9wZW5pbmcgYXQgYHN0YXJ0YFxuICAgKiAodGhlIHF1b3RlIGNoYXIpIHRvIGBvdXRgLCBtaXJyb3Jpbmcgc2hsZXgncyBlc2NhcGUgcnVsZXMgZm9yIGRvdWJsZVxuICAgKiBxdW90ZXMuIFJldHVybnMgdGhlIGluZGV4IGFmdGVyIHRoZSBjbG9zaW5nIHF1b3RlLCBvciBudWxsIHdoZW5cbiAgICogdW5iYWxhbmNlZC5cbiAgICovXG4gIGNvbnN0IGFwcGVuZFF1b3RlZENvbnRlbnQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGNvbnN0IHF1b3RlID0gc1tzdGFydF07XG4gICAgbGV0IGogPSBzdGFydCArIDE7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmIChxdW90ZSA9PT0gXCInXCIpIHtcbiAgICAgICAgaWYgKGMgPT09IFwiJ1wiKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBqICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2ogKyAxXSkpIHtcbiAgICAgICAgb3V0ICs9IHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSByYXcgYXR0YWNoZWQtdGFyZ2V0IHRleHQgc3RhcnRpbmcgYXQgYHN0YXJ0YCB0byBgb3V0YCBcdTIwMTRcbiAgICogdmVyYmF0aW0sIHF1b3RlZCBzZWN0aW9ucyBzcGFubmluZyBzcGFjZXMgaW5jbHVkZWQgXHUyMDE0IHN0b3BwaW5nIGF0XG4gICAqIHdoaXRlc3BhY2Ugb3IgYW5vdGhlciByZWRpcmVjdCBvcGVyYXRvci4gUmV0dXJucyB0aGUgbmV4dCBpbmRleCwgb3IgbnVsbFxuICAgKiBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAgICovXG4gIGNvbnN0IGFwcGVuZEF0dGFjaGVkVGFyZ2V0ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgaiA9IHN0YXJ0O1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAoL1xccy8udGVzdChjKSB8fCBjID09PSAnPCcgfHwgYyA9PT0gJz4nKSByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KCcnLCBqKTtcbiAgICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgICBvdXQgKz0gcy5zbGljZShqLCBzZWN0aW9uLm5leHQpO1xuICAgICAgICBqID0gc2VjdGlvbi5uZXh0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuKSB7XG4gICAgICAgIG91dCArPSBjICsgc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gIH07XG5cbiAgLyoqIEVtaXQgYSByZWRpcmVjdCB0b2tlbiB3aG9zZSB0ZXh0IHByZWZpeGVzIHRoZSBvcGVyYXRvciB3aXRoIHRoZSBjdXJyZW50IGRpZ2l0IGJ1ZmZlciAoYW4gSU9fTlVNQkVSIGxpa2UgYDI+YCkuICovXG4gIGNvbnN0IGVtaXRSZWRpcmVjdCA9IChvcGVyYXRvcjogc3RyaW5nLCBhdHRhY2hlZFN0YXJ0OiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBhdHRhY2hlZCA9IGFwcGVuZEF0dGFjaGVkVGFyZ2V0KCcnLCBhdHRhY2hlZFN0YXJ0KTtcbiAgICBpZiAoYXR0YWNoZWQgPT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiArIG9wZXJhdG9yICsgYXR0YWNoZWQub3V0LCBxdW90ZWQ6IGZhbHNlLCBpc1JlZGlyZWN0OiB0cnVlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICAgIGkgPSBhdHRhY2hlZC5uZXh0O1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBmbHVzaFdvcmQoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KGJ1ZiwgaSk7XG4gICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICBidWYgPSBzZWN0aW9uLm91dDtcbiAgICAgIGkgPSBzZWN0aW9uLm5leHQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBidWYgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyB8fCBjID09PSAnPicpIHtcbiAgICAgIC8vIEEgYDxgL2A+YCBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIGF0IGEgd29yZCBib3VuZGFyeSwgb3IgYWZ0ZXIgYW5cbiAgICAgIC8vIElPX05VTUJFUiBkaWdpdCBydW4gKGAxPmAsIGAyPmApOyBtaWQtd29yZCBpdCBlbmRzIHRoZSBjdXJyZW50IHdvcmRcbiAgICAgIC8vIGZpcnN0IChgZWNobyBhPmJgIFx1MjE5MiB3b3JkcyBgZWNob2AsIGBhYDsgcmVkaXJlY3QgYD5iYCkuXG4gICAgICBpZiAoYnVmICE9PSAnJyAmJiAhL15cXGQrJC8udGVzdChidWYpKSBmbHVzaFdvcmQoKTtcbiAgICAgIGxldCBvcGVyYXRvcjogc3RyaW5nO1xuICAgICAgaWYgKGMgPT09ICc8Jykge1xuICAgICAgICBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PDwnKSBvcGVyYXRvciA9ICc8PDwnO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8LScpIG9wZXJhdG9yID0gJzw8LSc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDIpID09PSAnPDwnKSBvcGVyYXRvciA9ICc8PCc7XG4gICAgICAgIGVsc2Ugb3BlcmF0b3IgPSAnPCc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDIpID09PSAnPj4nID8gJz4+JyA6ICc+JztcbiAgICAgIH1cbiAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBcdTIwMTQgdGhlIHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QgKGtlcHQgdG9nZXRoZXIgYnlcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpLiBBIGJhcmUgYCZgIGhlcmUgaXMgYW4gb3JkaW5hcnkgd29yZCBjaGFyIChgJjFgIGluXG4gICAgICAvLyBgMj4mMWAsIHdoaWNoIHRoZSBhdHRhY2hlZC10YXJnZXQgc2NhbiBhYm92ZSBjb25zdW1lZCBhbnl3YXkpLlxuICAgICAgaWYgKHNbaSArIDFdID09PSAnPicpIHtcbiAgICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMykgPT09ICcmPj4nID8gJyY+PicgOiAnJj4nO1xuICAgICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaFdvcmQoKTtcbiAgcmV0dXJuIHRva2Vucztcbn1cblxuLyoqXG4gKiBUaGUgYXR0YWNoZWQgdGFyZ2V0IG9mIGEgcmVkaXJlY3QgdG9rZW4sIG9yIG51bGwgd2hlbiB0aGUgb3BlcmF0b3IgaXNcbiAqIHN0YW5kYWxvbmUgKGA+YCB2cyBgPmZgOyBgMj5gIHZzIGAyPiYxYCkuIFNwbGl0cyBhbiBvcHRpb25hbCBJT19OVU1CRVJcbiAqIGRpZ2l0IHJ1biBvZmYgdGhlIGZyb250LCB0aGVuIHRoZSBvcGVyYXRvciwgbGVhdmluZyB0aGUgdGFyZ2V0LlxuICovXG5mdW5jdGlvbiByZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHRleHQubWF0Y2goL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLyk7XG4gIGlmIChtYXRjaCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssICwgLCByZXN0XSA9IG1hdGNoO1xuICByZXR1cm4gcmVzdC5sZW5ndGggPiAwID8gcmVzdCA6IG51bGw7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBhcmd2IGZvciBhIHNpbXBsZSBjb21tYW5kOiBsZWFkaW5nIGFzc2lnbm1lbnRzIHN0cmlwcGVkLCBxdW90ZS1hd2FyZSB0b2tlbnMgbWludXMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFuZCB0aGVpciB0YXJnZXRzLiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIHN0YW5kYWxvbmUgcmVkaXJlY3Qgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldDtcbiAgICAvLyBhbiBhdHRhY2hlZCBmb3JtIChgPmZgLCBgPj5mYCkgaXMgc2VsZi1jb250YWluZWQuXG4gICAgaWYgKHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodG9rZW4udGV4dCkgPT09IG51bGwpIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gYXJndjtcbn1cbiIsICIvKipcbiAqIFRoZSByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHBsYW4gXHUwMEE3NS43KSwgc2libGluZyB0b1xuICogbWVjaGFuaWNhbC1jaGFuZ2UudHMncyByYW5nZS1sZXNzIGBwYXJzZVVuaWZpZWREaWZmYC4gVGhlIHBhdGNoL2dpdCBhcHBseVxuICogZ3JhbW1hciBuZWVkcyB0aGUgYEBAIC1hLGIgK2MsZCBAQGAgaHVuayBudW1iZXJzIHRoYXQgcGFyc2VVbmlmaWVkRGlmZlxuICogZGlzY2FyZHMsIHNvIHRoaXMgcGFyc2VzIHRoZSBzYW1lIGhlYWRlciBkaWFsZWN0IGZyb20gc2NyYXRjaC5cbiAqXG4gKiBBIGh1bmsgd2hvc2UgcHJlL3Bvc3QgbGluZSBjb3VudHMgbWF0Y2ggcHJlc2VydmVzIGxpbmUgY29vcmRpbmF0ZXMsIHNvIGFcbiAqIGZpbGUgd2hvc2UgaHVua3MgYXJlIGFsbCBjb3VudC1wcmVzZXJ2aW5nIGdldHMgYW4gZXhhY3QgcmFuZ2UgXHUyMDE0IHRoZSB1bmlvbiBvZlxuICogZXZlcnkgaHVuaydzIHJlZ2lvbi4gQW55IGNvdW50LWNoYW5naW5nIGh1bmsgKHB1cmUgYWRkLCBwdXJlIGRlbGV0ZSwgdW5lcXVhbFxuICogY291bnRzKSBkZWdyYWRlcyB0aGUgZmlsZSB0byBhIHdob2xlLWZpbGUgbW9kaWZ5OiBwb3NpdGlvbnMgYmVsb3cgaXQgc2hpZnQsXG4gKiBhbmQgYSBkZWxldGVkIGxpbmUgb2NjdXBpZXMgbm8gcG9zdC1lZGl0IHJhbmdlIGF0IGFsbC5cbiAqXG4gKiBQZXItZmlsZSBjbGFzc2lmaWNhdGlvbnM6IGBuZXcgZmlsZSBtb2RlYCBcdTIxOTIgY3JlYXRlLW92ZXJ3cml0ZTsgYGRlbGV0ZWQgZmlsZVxuICogbW9kZWAgXHUyMTkyIGRlbGV0ZTsgYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCBcdTIxOTIgc291cmNlIGRlbGV0ZSArIGRlc3RcbiAqIHJlbmFtZS1jb3B5OyBiaW5hcnkgZGlmZnMgXHUyMTkyIHdob2xlLWZpbGUgbW9kaWZ5OyBhIGArKysgL2Rldi9udWxsYCB0YXJnZXQgKHRoZVxuICogc2hhcGUgYGRpZmYgLXVgLWZvcm1hdCBkZWxldGlvbnMgdGFrZSkgXHUyMTkyIGRlbGV0ZS5cbiAqXG4gKiBHaXQtc3R5bGUgYGEvXHUyMDI2YC9gYi9cdTIwMjZgIHByZWZpeGVzIGFyZSBzdHJpcHBlZCBwZXIgdGhlIGNhbGxlcidzIGAtcE5gIHN0cmlwXG4gKiBsZXZlbDogYSBudW1iZXIgc3RyaXBzIHRoYXQgbWFueSBsZWFkaW5nIHBhdGggY29tcG9uZW50cywgYW5kIGAnYXV0bydgXG4gKiAocGF0Y2gncyBkZWZhdWx0KSBzdHJpcHMgb25lIHdoZW4gdGhlIHBhdGggaXMgYS8tIG9yIGIvLXByZWZpeGVkIGFuZCBub25lXG4gKiBvdGhlcndpc2UuIGAvZGV2L251bGxgIGlzIGNoZWNrZWQgYmVmb3JlIHN0cmlwcGluZyBcdTIwMTQgdGhlIGhlYWRlciBtYXJrZXJcbiAqIHdvdWxkIG90aGVyd2lzZSBsb3NlIGl0cyBgZGV2L2AgY29tcG9uZW50LlxuICpcbiAqIE1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0IHJldHVybnMgbnVsbCAoZmFpbCBjbG9zZWQgXHUyMDE0IHRoZSBjYWxsZXIgZW1pdHNcbiAqIHVucmVzb2x2ZWQgcmF0aGVyIHRoYW4gZ3Vlc3NpbmcgYXQgdGFyZ2V0cykuXG4gKi9cblxuLyoqIFRoZSBgLXBOYCBoZWFkZXIgc3RyaXAgbGV2ZWw6IGEgY29tcG9uZW50IGNvdW50LCBvciBwYXRjaCdzIGAnYXV0bydgIGRlZmF1bHQuICovXG5leHBvcnQgdHlwZSBQYXRoU3RyaXAgPSBudW1iZXIgfCAnYXV0byc7XG5cbi8qKiBPbmUgZmlsZSBhIHBhdGNoIHRvdWNoZXM6IHRoZSB0YXJnZXQgcGF0aCwgdGhlIHRvdWNoIGtpbmQsIGFuZCB0aGUgZXhhY3QgcmFuZ2Ugd2hlbiB0aGUgaHVua3MgcHJlc2VydmUgbGluZSBjb3VudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFVuaWZpZWREaWZmVGFyZ2V0IHtcbiAgcGF0aDogc3RyaW5nO1xuICBvcGVyYXRpb246ICdtb2RpZnknIHwgJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ2RlbGV0ZScgfCAncmVuYW1lLWNvcHknO1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG59XG5cbmNvbnN0IEhVTktfSEVBREVSID0gL15AQCAtKFxcZCspKD86LChcXGQrKSk/IFxcKyhcXGQrKSg/OiwoXFxkKykpPyBAQC87XG5cbi8qKiBTdHJpcCB0aGUgZmlyc3QgYG5gIGxlYWRpbmcgcGF0aCBjb21wb25lbnRzIChgLXBOYCksIHN0b3BwaW5nIGF0IGEgY29tcG9uZW50LWxlc3MgcGF0aC4gKi9cbmZ1bmN0aW9uIHN0cmlwUGF0aENvbXBvbmVudHMocDogc3RyaW5nLCBuOiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgcyA9IHA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgY29uc3Qgc2xhc2ggPSBzLmluZGV4T2YoJy8nKTtcbiAgICBpZiAoc2xhc2ggPT09IC0xKSByZXR1cm4gcztcbiAgICBzID0gcy5zbGljZShzbGFzaCArIDEpO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG4vKipcbiAqIFRoZSBsZXZlbCB0byBzdHJpcCBmcm9tIGByYXdgIHVuZGVyIGBzdHJpcGA6IGEgbnVtYmVyIHBhc3NlcyB0aHJvdWdoOyBgJ2F1dG8nYFxuICogcmVzb2x2ZXMgdG8gcDEgd2hlbiB0aGUgcGF0aCBpcyBgYS9gL2BiL2AtcHJlZml4ZWQgYW5kIHAwIG90aGVyd2lzZSBcdTIwMTQgcGF0Y2gnc1xuICogZGVmYXVsdCBmb3IgZGlmZnMgd2hvc2UgcHJlZml4ZXMgYXJlIGBkaWZmIC11YC1zdHlsZSByYXRoZXIgdGhhbiBnaXQncy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBMZXZlbEZvcihyYXc6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IG51bWJlciB7XG4gIHJldHVybiBzdHJpcCA9PT0gJ2F1dG8nID8gKHJhdy5zdGFydHNXaXRoKCdhLycpIHx8IHJhdy5zdGFydHNXaXRoKCdiLycpID8gMSA6IDApIDogc3RyaXA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBVbmlmaWVkRGlmZlRhcmdldFtdIHwgbnVsbCB7XG4gIGNvbnN0IHJlc3VsdHM6IFVuaWZpZWREaWZmVGFyZ2V0W10gPSBbXTtcbiAgbGV0IHNhd0Jsb2NrID0gZmFsc2U7XG4gIGxldCBjdXJyZW50OiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGtpbmQ6ICdtb2RpZnknIHwgJ25ldycgfCAnZGVsZXRlZCc7XG4gICAgaHVua3M6IEFycmF5PHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfT47XG4gICAgY291bnRDaGFuZ2luZzogYm9vbGVhbjtcbiAgfSB8IG51bGwgPSBudWxsO1xuICBsZXQgcGVuZGluZ0tpbmQ6ICduZXcnIHwgJ2RlbGV0ZWQnIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVGcm9tOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZVRvOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGJpbmFyeSA9IGZhbHNlO1xuXG4gIC8qKiBUaGUgaGVhZGVyIHBhdGggd2l0aCB0aGUgYC1wTmAgbGV2ZWwgYXBwbGllZCBcdTIwMTQgYC9kZXYvbnVsbGAga2VwdCB2ZXJiYXRpbSAodGhlIG1hcmtlciBpcyBuZXZlciBhIHJlYWwgcGF0aCkuICovXG4gIGNvbnN0IHN0cmlwcGVkID0gKHJhdzogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICBpZiAocmF3ID09PSAnL2Rldi9udWxsJykgcmV0dXJuIHJhdztcbiAgICByZXR1cm4gc3RyaXBQYXRoQ29tcG9uZW50cyhyYXcsIHN0cmlwTGV2ZWxGb3IocmF3LCBzdHJpcCkpO1xuICB9O1xuXG4gIGNvbnN0IGZpbmlzaCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGN1cnJlbnQua2luZCA9PT0gJ25ldycpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LmtpbmQgPT09ICdkZWxldGVkJykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgICAgZWxzZSBpZiAoYmluYXJ5KSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50Lmh1bmtzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBBIGhlYWRlci1vbmx5IGJsb2NrIHdpdGggbm8gaHVua3M6IG5vdGhpbmcgc3RhdGljYWxseSBrbm93bi5cbiAgICAgIH0gZWxzZSBpZiAoY3VycmVudC5jb3VudENoYW5naW5nKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbiguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5zdGFydCkpO1xuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heCguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5lbmQpKTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQgfSk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHJlbmFtZUZyb20gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZUZyb20sIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgaWYgKHJlbmFtZVRvICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVUbywgb3BlcmF0aW9uOiAncmVuYW1lLWNvcHknIH0pO1xuICAgIHJlbmFtZUZyb20gPSBudWxsO1xuICAgIHJlbmFtZVRvID0gbnVsbDtcbiAgICBiaW5hcnkgPSBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgcGF0Y2hUZXh0LnNwbGl0KCdcXG4nKSkge1xuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJy0tLSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgY3VycmVudCA9IHtcbiAgICAgICAgcGF0aDogc3RyaXBwZWQobGluZS5zbGljZSg0KSksXG4gICAgICAgIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLFxuICAgICAgICBodW5rczogW10sXG4gICAgICAgIGNvdW50Q2hhbmdpbmc6IGZhbHNlXG4gICAgICB9O1xuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJysrKyAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgY29uc3QgcGF0aCA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpO1xuICAgICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIGN1cnJlbnQgPSB7IHBhdGgsIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLCBodW5rczogW10sIGNvdW50Q2hhbmdpbmc6IGZhbHNlIH07XG4gICAgICBlbHNlIGlmIChwYXRoID09PSAnL2Rldi9udWxsJykgY3VycmVudC5raW5kID0gJ2RlbGV0ZWQnO1xuICAgICAgZWxzZSBjdXJyZW50LnBhdGggPSBwYXRoO1xuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ25ldyBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnbmV3JztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkZWxldGVkIGZpbGUgbW9kZScpKSB7XG4gICAgICBwZW5kaW5nS2luZCA9ICdkZWxldGVkJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdyZW5hbWUgZnJvbSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgcmVuYW1lRnJvbSA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSBmcm9tICcubGVuZ3RoKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIHRvICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICByZW5hbWVUbyA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSB0byAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ0JpbmFyeSBmaWxlcyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ0dJVCBiaW5hcnkgcGF0Y2gnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgYmluYXJ5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBodW5rID0gbGluZS5tYXRjaChIVU5LX0hFQURFUik7XG4gICAgaWYgKGh1bmspIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHByZVN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KGh1bmtbMV0sIDEwKTtcbiAgICAgIGNvbnN0IHByZUNvdW50ID0gaHVua1syXSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzJdLCAxMCk7XG4gICAgICBjb25zdCBwb3N0Q291bnQgPSBodW5rWzRdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbNF0sIDEwKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSByZXR1cm4gbnVsbDsgLy8gYSBodW5rIHdpdGhvdXQgYSBmaWxlIGhlYWRlciBcdTIxOTIgbWFsZm9ybWVkXG4gICAgICBpZiAocHJlQ291bnQgIT09IHBvc3RDb3VudCkgY3VycmVudC5jb3VudENoYW5naW5nID0gdHJ1ZTtcbiAgICAgIGlmIChwcmVDb3VudCA+IDApIGN1cnJlbnQuaHVua3MucHVzaCh7IHN0YXJ0OiBwcmVTdGFydCwgZW5kOiBwcmVTdGFydCArIHByZUNvdW50IC0gMSB9KTtcbiAgICB9XG4gIH1cbiAgZmluaXNoKCk7XG4gIHJldHVybiBzYXdCbG9jayA/IHJlc3VsdHMgOiBudWxsO1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCB0b3VjaCBjb3JlIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmVcbiAqIGdlbnVpbmVseSBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rXG4gKiBkb2VzLCBiZWNhdXNlIENvZGV4IGRlbGl2ZXJzIGV2ZXJ5IGVkaXQgYXMgYSBzaW5nbGUgYXBwbHlfcGF0Y2ggZW52ZWxvcGVcbiAqIHJhdGhlciB0aGFuIGEgdHlwZWQgdG9vbCBpbnB1dC5cbiAqXG4gKiBUaGUgbW9kdWxlIGlzIHB1cmU6IGl0IGltcG9ydHMgb25seSB0aGUga2VybmVsIGFuY2hvciB0eXBlcyBhbmQgbmV2ZXIgdG91Y2hlc1xuICogdGhlIENvZGV4IFNESywgc28gaXQgaXMgREktdGVzdGFibGUgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGVcbiAqIHNoYXJlZCBrZXJuZWwuIFJhbmdlIHJlY292ZXJ5IGlzIGJlc3QtZWZmb3J0IFx1MjAxNCB0aGUgYXBwbHlfcGF0Y2ggZm9ybWF0IGNhcnJpZXNcbiAqIGBAQGAgY29udGV4dCBhbmQgYCtgL2AtYC9zcGFjZSBjaGFuZ2UgbGluZXMgYnV0IG5vIGV4cGxpY2l0IGxpbmUgbnVtYmVycywgc28gYVxuICogcmFuZ2UgY2FuIG9ubHkgYmUgcmVjb3ZlcmVkIGJ5IGxvY2F0aW5nIGEgaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZVxuICogb24tZGlzayBmaWxlLiBUaGF0IGZpbGUgcmVhZCBpcyBpbmplY3RlZCAoYHJlYWRQcmVFZGl0RmlsZWApIHNvIHRoZSBmdW5jdGlvblxuICogc3RheXMgcHVyZSBhbmQgdGVzdGFibGUuIE9uIEFOWSBhbWJpZ3VpdHkgKG5vIHJlYWRlciwgZmlsZSBtaXNzaW5nLCBjb250ZXh0XG4gKiBub3QgZm91bmQsIGZ1enp5L2R1cGxpY2F0ZSBtYXRjaCkgdGhlIHBhcnNlciBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yXG4gKiByYXRoZXIgdGhhbiB0aHJvd2luZyBcdTIwMTQgd2hvbGUtZmlsZSBhbmNob3JzIGFyZSBmaXJzdC1jbGFzcyBhbmQgdG91Y2ggdHJhY2tpbmdcbiAqIG11c3QgbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogQW4gYW5jaG9yIHBhcnNlZCBmcm9tIGFuIGFwcGx5X3BhdGNoIGVudmVsb3BlOiBhbiB7QGxpbmsgQW5jaG9yU3BlY30gcGx1c1xuICogdGhlIGRlbGV0ZSBjbGFzc2lmaWNhdGlvbiAocGxhbiBcdTAwQTczKS4gYCoqKiBEZWxldGUgRmlsZTpgIGh1bmtzIGtlZXAgdGhlXG4gKiBgd2hvbGUtd3JpdGVgIGtpbmQgKFRvdWNoS2luZCBpcyBmaXhlZCkgYW5kIGFkZCB0aGUgYGFic2VudGAgbWFya2VyIHNvIHRoZVxuICogYXBwbHlfcGF0Y2ggY2FsbCBzaXRlIHBhc3NlcyBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIwMTQgd2l0aG91dCBpdCB0aGVcbiAqIGRlbGV0aW9uIHRvdWNoIHdvdWxkIGJlIGdhdGVkIGF3YXkgYnkgdGhlIGAnZXhpc3RzJ2AgZGVmYXVsdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBcHBseVBhdGNoQW5jaG9yIGV4dGVuZHMgQW5jaG9yU3BlYyB7XG4gIC8qKiB0cnVlIGZvciBgKioqIERlbGV0ZSBGaWxlOmAgaHVua3MgXHUyMDE0IHRoZSB0b3VjaCdzIHRhcmdldFN0YXRlIGlzIGAnYWJzZW50J2AuICovXG4gIGFic2VudD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCB3aXRoIHRoZSBgYWJzZW50YCBtYXJrZXIgKHdob2xlLWZpbGU7XG4gKiAgIHRoZSBmaWxlIG5vIGxvbmdlciBleGlzdHMgXHUyMDE0IHRoZSB0b3VjaCB0YXJnZXRzIGFic2VuY2UsIHBsYW4gXHUwMEE3MylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFwcGx5UGF0Y2hBbmNob3JbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFwcGx5UGF0Y2hBbmNob3JbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnLCBhYnNlbnQ6IHRydWUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGU6IGFuY2hvciBvbiB0aGUgZGVzdGluYXRpb24gcGF0aCAocG9zdC1lZGl0IGxvY2F0aW9uKS5cbiAgICBjb25zdCB0YXJnZXRQYXRoID0gdG9Qb3NpeChodW5rLm1vdmVQYXRoID8/IGh1bmsucGF0aCk7XG5cbiAgICAvLyBBIHJlbmFtZSBkZWZlYXRzIHByZS1lZGl0IGxpbmUgbWFwcGluZyBcdTIwMTQgYW5jaG9yIHdob2xlLWZpbGUgb24gdGhlIHRhcmdldC5cbiAgICBpZiAoaHVuay5tb3ZlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dob2xlLXdyaXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFJhbmdlIHJlY292ZXJ5IHJlYWRzIHRoZSBwcmUtZWRpdCBjb250ZW50IGF0IHRoZSBvcmlnaW5hbCAocHJlLW1vdmUpIHBhdGguXG4gICAgY29uc3QgY29udGVudCA9IHJlYWRQcmVFZGl0RmlsZShodW5rLnBhdGgpO1xuICAgIGNvbnN0IHJhbmdlID0gY29udGVudCA9PT0gbnVsbCA/IG51bGwgOiByZWNvdmVyUmFuZ2Uoc3BsaXRMaW5lcyhjb250ZW50KSwgaHVuay5jaHVua3MpO1xuICAgIGlmIChyYW5nZSAhPT0gbnVsbCkge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdGFyZ2V0UGF0aCwga2luZDogJ3dyaXRlJywgcmFuZ2UgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFuY2hvcnM7XG59XG4iLCAiLyoqXG4gKiBDb2RleCBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCBoZWFsICsgc3VyZmFjZSBhZnRlciBhIGNvbmZpcm1lZCBgYXBwbHlfcGF0Y2hgLFxuICogb3IgYSBzaGVsbC9leGVjIGNhbGwgd2hvc2UgY29tbWFuZCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIGZpbGUrbGluZSBpZGlvbXMuXG4gKlxuICogUG9zdFRvb2xVc2UgZmlyZXMgYWZ0ZXIgYGFwcGx5X3BhdGNoYCBoYXMgcnVuLCBzbyB0aGlzIGlzIHRoZSBhY2N1cmF0ZSBob21lIGZvclxuICogdGhlIHRvdWNoIHNpZ25hbDogdGhlIGZpbGUgaXMgYWxyZWFkeSB3cml0dGVuLCBzbyBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnRcbiAqIDxmaWxlPiAtLWZpeGAgaGVhbHMgcG9zaXRpb25hbCBkcmlmdCBhZ2FpbnN0IHJlYWwgYnl0ZXMgYW5kIHRoZSBzdXJmYWNlZCBibG9ja1xuICogcmVmbGVjdHMgdGhlIGhlYWxlZCBhbmNob3JzLiBUaGUgaGFuZGxlciBuYXJyb3dzIHRoZSBgYXBwbHlfcGF0Y2hgIGVudmVsb3BlXG4gKiAoYHRvb2xfaW5wdXQuY29tbWFuZGAsIFNESy10eXBlZCBgdW5rbm93bmApIGludG8gcGVyLWZpbGUgYW5jaG9ycyB2aWEgdGhlXG4gKiBzaGFyZWQgW2FwcGx5LXBhdGNoIHBhcnNlcl0oLi9hcHBseS1wYXRjaC50cyksIGFuZCByZWNvdmVycyBzaGVsbCBjb21tYW5kc1xuICogZnJvbSBlaXRoZXIgQ29kZXggZW52ZWxvcGUgKGNsYXNzaWMgYGV4ZWNfY29tbWFuZGAgSlNPTiBgYXJndW1lbnRzYCwgb3JcbiAqIGNvZGUtbW9kZSBgZXhlY2Agd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgKSB2aWEgdGhlIHNoYXJlZFxuICogW2NvbW1hbmQgcGFyc2VyXSguLi9jb21tb24vcGFyc2UtY29tbWFuZC50cyk7IGVhY2ggdG91Y2hlZCBmaWxlIGlzIHNjb3BlZCB0b1xuICogdGhlIENXRCByZXBvLCBhbmQgZHJpdmVzIHRoZSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmUgXHUyMDE0IHRoZVxuICogc2FtZSBjb3JlIHRoZSBDbGF1ZGUgYWRhcHRlciB1c2VzLlxuICpcbiAqIFR3byBDb2RleC1zcGVjaWZpYyBjb25jZXJucyBhcmUgcHJlc2VydmVkIGZyb20gdGhpcyBmaWxlJ3Mgam91cm5hbGluZ1xuICogcHJlZGVjZXNzb3I6XG4gKlxuICogMS4gKipTdWNjZXNzIGNsYXNzaWZpY2F0aW9uLioqIFRoZSBwYXJzZWQgZW52ZWxvcGUgZGVzY3JpYmVzICppbnRlbnQqLCBub3RcbiAqICAgICpvdXRjb21lKi4gQ29kZXggY29yZSBmaXJlcyBQb3N0VG9vbFVzZSBvbmx5IG9uIHRvb2wgc3VjY2VzcywgYnV0IGFzIGFcbiAqICAgIGR1cmFiaWxpdHkgYmVsdCB3ZSBjbGFzc2lmeSBgdG9vbF9yZXNwb25zZWAgdmlhXG4gKiAgICB7QGxpbmsgY2xhc3NpZnlBcHBseVBhdGNoUmVzcG9uc2V9OiBhIGNvbmZpcm1lZCByZWplY3Rpb24gKGAnZmFpbHVyZSdgKVxuICogICAgc3VwcHJlc3NlcyB0aGUgdG91Y2ggKG5vIHBoYW50b20gaGVhbC9zdXJmYWNlIG9uIGEgcGF0Y2ggdGhhdCBuZXZlclxuICogICAgYXBwbGllZCk7IGEgc3VjY2VzcyBvciBhbiB1bnJlY29nbml6ZWQgc2hhcGUgKGAndW5rbm93bidgLCB3YXJuZWQpIHByb2NlZWRzLlxuICogMi4gKipObyBwb3N0LWVkaXQgcmFuZ2UgcmVjb3ZlcnkgZnJvbSB0aGUgZW52ZWxvcGUuKiogUG9zdFRvb2xVc2UgcnVucyBhZnRlclxuICogICAgdGhlIHBhdGNoIHJld3JvdGUgdGhlIGZpbGUsIHNvIHRoZSBodW5rJ3MgcHJlLWVkaXQgYmxvY2sgbm8gbG9uZ2VyIHNpdHNcbiAqICAgIHdoZXJlIHRoZSBlZGl0IGhhcHBlbmVkIGFuZCBjb3VsZCBtaXMtYW5jaG9yIGEgZHVwbGljYXRlLiBUaGUgdG91Y2ggaXNcbiAqICAgIHNjb3BlZCBmaWxlLXdpZGUgKGB3cml0dGVuOiAnJ2AgXHUyMTkyIHdob2xlLWZpbGUpLCB3aGljaCBpcyBleGFjdGx5IHRoZVxuICogICAgYmVoYXZpb3Ige0BsaW5rIHJ1blRvdWNoSG9va30gdGFrZXMgZm9yIGFuIGVtcHR5IHdyaXRlLlxuICpcbiAqIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBpbiB0aGUgaGFuZGxlciBjb25maWcgKHRoZSBDTEkgZW1pdHMgYDEwYCBzZWNvbmRzKVxuICogXHUyMDE0IHNlZSB0aGUgdGltZW91dC11bml0cyBzcGlrZSBub3RlOyB0aGUgc291cmNlIHZhbHVlIG11c3Qgc3RheSBpbiBtcyBzbyB0aGVcbiAqIENvZGV4IGJ1aWxkJ3Mgc2Vjb25kcyBjb252ZXJzaW9uIGF0IGVtaXQgcmVtYWlucyBjb3JyZWN0LlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUG9zdFRvb2xVc2VJbnB1dCwgcG9zdFRvb2xVc2VIb29rLCBwb3N0VG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQgeyBhYnNwYXRoQWdhaW5zdCB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQsIHJ1bkJhc2hUb3VjaGVzIH0gZnJvbSAnLi4vY29tbW9uL2Jhc2gtdG91Y2guanMnO1xuaW1wb3J0IHsgcGFyc2VDb21tYW5kRGV0YWlsZWQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLCBydW5Ub3VjaEhvb2ssIHR5cGUgVG91Y2hFeGVjdXRvcnMgfSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5pbXBvcnQgeyBwYXJzZUFwcGx5UGF0Y2ggfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcblxuLyoqXG4gKiBUaGUgcHJlZml4IGFwcGx5X3BhdGNoJ3Mgc3Rkb3V0IGNhcnJpZXMgd2hlbiBcdTIwMTQgYW5kIG9ubHkgd2hlbiBcdTIwMTQgdGhlIHBhdGNoXG4gKiBhcHBsaWVkIChjb2RleC1ycy9hcHBseS1wYXRjaCBgcHJpbnRfc3VtbWFyeWApLiBDb2RleCBzdXJmYWNlcyB0aGF0IHN0ZG91dFxuICogdmVyYmF0aW0gYXMgdGhlIFBvc3RUb29sVXNlIGB0b29sX3Jlc3BvbnNlYCAoYSBiYXJlIHN0cmluZyB0b2RheSkuIEZpeGVkXG4gKiBhY3Jvc3MgQWRkL01vZGlmeS9EZWxldGU7IHRoZSBoZWFkZXIgaXMgZm9sbG93ZWQgYnkgYEEvTS9EIDxwYXRoPmAgbGluZXMuXG4gKi9cbmNvbnN0IEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYID0gJ1N1Y2Nlc3MuIFVwZGF0ZWQgdGhlIGZvbGxvd2luZyBmaWxlczonO1xuXG4vKipcbiAqIFRoZSBjb21tb24gZmllbGRzIGFuIG9iamVjdC13cmFwcGVkIHRvb2xfcmVzcG9uc2UgbWlnaHQgY2FycnkgdGhlIHRvb2wncyB0ZXh0XG4gKiBvdXRwdXQgdW5kZXIsIGlmIENvZGV4IGV2ZXIgc3RvcHMgc3VyZmFjaW5nIGl0IGFzIGEgYmFyZSBzdHJpbmcuIE9yZGVyZWQgYnlcbiAqIGxpa2VsaWhvb2Q7IHRoZSBmaXJzdCBmaWVsZCB3aG9zZSB2YWx1ZSBpcyBhIHN0cmluZyB3aW5zLlxuICovXG5jb25zdCBSRVNQT05TRV9URVhUX0ZJRUxEUyA9IFsnb3V0cHV0JywgJ3N0ZG91dCcsICdjb250ZW50JywgJ3RleHQnXSBhcyBjb25zdDtcblxuLyoqIE5hcnJvdyB0aGUgU0RLJ3MgYHVua25vd25gIHRvb2xfaW5wdXQgdG8gdGhlIGBhcHBseV9wYXRjaGAgYHsgY29tbWFuZCB9YCBzaGFwZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnY29tbWFuZCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gICAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjbGFzc2ljIGBleGVjX2NvbW1hbmRgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjQgMC4xMzAuMCk6XG4gKiBgdG9vbF9pbnB1dC5hcmd1bWVudHNgIGlzIGEgSlNPTiAqc3RyaW5nKiBvZiBzaGFwZVxuICogYHtcImNtZFwiOiBcIi4uLlwiLCBcIndvcmtkaXJcIjogXCIuLi5cIn1gIFx1MjAxNCBwYXJzZSBpdCBhbmQgcmV0dXJuIHRoZSBgY21kYC4gUmV0dXJuc1xuICogYG51bGxgIGZvciBhbnkgb3RoZXIgc2hhcGUgKG5vdCBKU09OLCBubyBgY21kYCBmaWVsZCwgb3Igbm90IHRoaXMgZW52ZWxvcGUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93RXhlY0NvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2FyZ3VtZW50cycgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgYXJncyA9ICh0b29sSW5wdXQgYXMgeyBhcmd1bWVudHM6IHVua25vd24gfSkuYXJndW1lbnRzO1xuICAgIGlmICh0eXBlb2YgYXJncyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoYXJncyk7XG4gICAgICAgIGlmIChwYXJzZWQgIT09IG51bGwgJiYgdHlwZW9mIHBhcnNlZCA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIHBhcnNlZC5jbWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIHBhcnNlZC5jbWQ7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBuYXJyb3dpbmcgdGhlIGNvZGUtbW9kZSBgZXhlY2AgZW52ZWxvcGUuIGBtYXRjaGVkYCBzZXBhcmF0ZXNcbiAqIFwidGhlIGVudmVsb3BlIHdhcyBhIGB0b29scy5leGVjX2NvbW1hbmQoey4uLn0pYCBjYWxsIHdob3NlIGFyZ3VtZW50IGNvdWxkIG5vdFxuICogYmUgcmVjb3ZlcmVkXCIgKGEgdmFyaWFibGUvdGVtcGxhdGUtYnVpbHQgY29tbWFuZCBcdTIwMTQgc3RhdGljYWxseSB1bnJlc29sdmFibGUpXG4gKiBmcm9tIFwidGhlIGVudmVsb3BlIGlzIG5vdCBjb2RlLW1vZGUgZXhlYyBhdCBhbGxcIiwgc28gdGhlIGhhbmRsZXIgY2FuIHdhcm4gb25cbiAqIHRoZSBmb3JtZXIgaW5zdGVhZCBvZiBzaWxlbnRseSBjb25mbGF0aW5nIGl0IHdpdGggdGhlIGxhdHRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb2RlTW9kZUV4ZWNOYXJyb3cge1xuICAvKiogV2hldGhlciBgdG9vbF9pbnB1dC5pbnB1dGAgY29udGFpbmVkIGEgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIGNhbGwuICovXG4gIG1hdGNoZWQ6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmVjb3ZlcmVkIGBjbWRgIHN0cmluZywgb3IgYG51bGxgIHdoZW4gbWF0Y2hlZCBidXQgdW5wYXJzYWJsZSAvIGFic2VudC4gKi9cbiAgY21kOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFF1b3RlIGJhcmUgaWRlbnRpZmllciBrZXlzIGluIGEgSlMgb2JqZWN0IGxpdGVyYWwgc28gYEpTT04ucGFyc2VgIGNhbiByZWFkXG4gKiBpdC4gUmVhbCBjb2RlLW1vZGUgY2FsbCBzaXRlcyBlbWl0IEpTLXN0eWxlIHVucXVvdGVkIGtleXNcbiAqIChge2NtZDpcInNlZCAtbiAnMSwyNDBwJyAvcGF0aFwiLC4uLn1gKSwgd2hpY2ggaXMgdmFsaWQgSlMgYnV0IGludmFsaWQgSlNPTi5cbiAqIFN0cmluZyB2YWx1ZXMgKHNpbmdsZS0gb3IgZG91YmxlLXF1b3RlZCkgYXJlIGNvcGllZCB2ZXJiYXRpbSBcdTIwMTQgaW5jbHVkaW5nIGFueVxuICogYCwga2V5OmAtc2hhcGVkIHRleHQgaW5zaWRlIHRoZW0gXHUyMDE0IGFuZCBhbHJlYWR5LXF1b3RlZCBrZXlzIHBhc3MgdGhyb3VnaFxuICogdW50b3VjaGVkLlxuICovXG5mdW5jdGlvbiBxdW90ZU9iamVjdEtleXMobGl0ZXJhbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBsaXRlcmFsLmxlbmd0aDtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGxpdGVyYWxbaV07XG4gICAgaWYgKGMgPT09ICdcIicgfHwgYyA9PT0gXCInXCIpIHtcbiAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgIGNvbnN0IHN0YXJ0ID0gaTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbikge1xuICAgICAgICBpZiAobGl0ZXJhbFtpXSA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikgaSArPSAyO1xuICAgICAgICBlbHNlIGlmIChsaXRlcmFsW2ldID09PSBxdW90ZSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBsaXRlcmFsLnNsaWNlKHN0YXJ0LCBpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBrZXkgPSBsaXRlcmFsLnNsaWNlKGkpLm1hdGNoKC9eKFxce3wsKVxccyooW0EtWmEtel8kXVtBLVphLXowLTlfJF0qKVxccyo6Lyk7XG4gICAgaWYgKGtleSkge1xuICAgICAgb3V0ICs9IGAke2tleVsxXX1cIiR7a2V5WzJdfVwiOmA7XG4gICAgICBpICs9IGtleVswXS5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3V0ICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogTmFycm93IHRoZSBjb2RlLW1vZGUgYGV4ZWNgIGVudmVsb3BlIChjbGlfdmVyc2lvbiBcdTIyNjUgMC4xNDQuMCk6XG4gKiBgdG9vbF9pbnB1dC5pbnB1dGAgaXMgSlMgc291cmNlIHRoYXQgY2FsbHMgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgIFx1MjAxNFxuICogcmVjb3ZlciB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnQgdmlhIGJhbGFuY2VkLWJyYWNlIG1hdGNoaW5nLCBxdW90ZSBpdHNcbiAqIHVucXVvdGVkIEpTIGtleXMsIGFuZCBwYXJzZSBpdC4gQSBjb21tYW5kIGJ1aWx0IGZyb20gdmFyaWFibGVzIG9yIHRlbXBsYXRlXG4gKiBsaXRlcmFscyBpcyBzdGF0aWNhbGx5IHVucmVzb2x2YWJsZTogdGhlIGNhbGwgc3RpbGwgKm1hdGNoZWQqIGJ1dCB5aWVsZHNcbiAqIGBjbWQ6IG51bGxgLCByZXBvcnRlZCBkaXN0aW5jdGx5IGZyb20gYSBub24tY29kZS1tb2RlIGVudmVsb3BlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmFycm93Q29kZU1vZGVFeGVjKHRvb2xJbnB1dDogdW5rbm93bik6IENvZGVNb2RlRXhlY05hcnJvdyB7XG4gIGlmICh0b29sSW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xJbnB1dCA9PT0gJ29iamVjdCcgJiYgJ2lucHV0JyBpbiB0b29sSW5wdXQpIHtcbiAgICBjb25zdCBpbnB1dCA9ICh0b29sSW5wdXQgYXMgeyBpbnB1dDogdW5rbm93biB9KS5pbnB1dDtcbiAgICBpZiAodHlwZW9mIGlucHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgLy8gTWF0Y2ggdG9vbHMuZXhlY19jb21tYW5kKHsuLi59KSBcdTIwMTQgZXh0cmFjdCB0aGUgbGl0ZXJhbCBvYmplY3QgYXJndW1lbnRcbiAgICAgIGNvbnN0IG1hdGNoID0gaW5wdXQubWF0Y2goL3Rvb2xzXFwuZXhlY19jb21tYW5kXFwoXFxzKihcXHsoPzpbXnt9XXxcXHsoPzpbXnt9XXxcXHtbXnt9XSpcXH0pKlxcfSkqXFx9KVxccypcXCkvKTtcbiAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocXVvdGVPYmplY3RLZXlzKG1hdGNoWzFdKSk7XG4gICAgICAgICAgaWYgKHBhcnNlZCAhPT0gbnVsbCAmJiB0eXBlb2YgcGFyc2VkID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgcGFyc2VkLmNtZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7IG1hdGNoZWQ6IHRydWUsIGNtZDogcGFyc2VkLmNtZCB9O1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwgfTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gbWF0Y2hlZCwgYnV0IHRoZSBsaXRlcmFsIGRpZCBub3QgcGFyc2UgXHUyMDE0IHRoZSBjYWxsIGlzIHN0aWxsIGFcbiAgICAgICAgICAvLyBjb2RlLW1vZGUgZXhlYyB3aG9zZSBjb21tYW5kIGNhbm5vdCBiZSByZWNvdmVyZWQgc3RhdGljYWxseS5cbiAgICAgICAgICByZXR1cm4geyBtYXRjaGVkOiB0cnVlLCBjbWQ6IG51bGwgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVkOiBmYWxzZSwgY21kOiBudWxsIH07XG59XG5cbi8qKlxuICogVG9sZXJhbnRseSBwdWxsIHRoZSB0b29sJ3MgdGV4dHVhbCBvdXRwdXQgb3V0IG9mIGEgYHRvb2xfcmVzcG9uc2VgIG9mXG4gKiB1bmNlcnRhaW4gc2hhcGUgKFNESy10eXBlZCBgdW5rbm93bmApOiBhIGJhcmUgc3RyaW5nICh0b2RheSdzIENvZGV4KSBpc1xuICogcmV0dXJuZWQgYXMtaXM7IGFuIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9XG4gKiBlbnRyeSB0aGF0IGhvbGRzIGEgc3RyaW5nLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIHRleHQgY2FuIGJlIHJlY292ZXJlZFxuICogKHVua25vd24gb2JqZWN0IHNoYXBlLCBgbnVsbGAsIG9yIGEgbm9uLXN0cmluZy9ub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlclxuICogdHJlYXRzIGFzIGFuICp1bnJlY29nbml6ZWQqIFx1MjAxNCBub3QgKmZhaWxlZCogXHUyMDE0IHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBleHRyYWN0UmVzcG9uc2VUZXh0KHRvb2xSZXNwb25zZTogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ3N0cmluZycpIHJldHVybiB0b29sUmVzcG9uc2U7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogQ2xhc3NpZnkgYW4gYGFwcGx5X3BhdGNoYCBgdG9vbF9yZXNwb25zZWAgZm9yIHRoZSB0b3VjaCBnYXRlOlxuICpcbiAqIC0gYCdzdWNjZXNzJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBhbmQgY2FycmllcyB7QGxpbmsgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVh9LlxuICogLSBgJ2ZhaWx1cmUnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGJ1dCBsYWNrcyB0aGUgaGVhZGVyOiBhIGdlbnVpbmUgcmVqZWN0aW9uXG4gKiAgIG9yIGVycm9yLiBUaGUgT05MWSBjbGFzc2lmaWNhdGlvbiB0aGF0IHN1cHByZXNzZXMgdGhlIHRvdWNoLlxuICogLSBgJ3Vua25vd24nYCBcdTIwMTQgbm8gdGV4dCBjb3VsZCBiZSByZWNvdmVyZWQgKHVucmVjb2duaXplZCBzaGFwZSkuIFdlIHByb2NlZWRcbiAqICAgZGVmZW5zaXZlbHkgaGVyZSByYXRoZXIgdGhhbiByaXNrIG1pc3NpbmcgYSByZWFsIGVkaXQncyBoZWFsL3N1cmZhY2U7IENvZGV4XG4gKiAgIGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiBzdWNjZXNzLCBzbyB0aGlzIGNhbm5vdCBoZWFsL3N1cmZhY2UgYSBwYXRjaFxuICogICB0aGF0IG5ldmVyIGFwcGxpZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bicge1xuICBjb25zdCB0ZXh0ID0gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2UpO1xuICBpZiAodGV4dCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgcmV0dXJuIHRleHQuc3RhcnRzV2l0aChBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCkgPyAnc3VjY2VzcycgOiAnZmFpbHVyZSc7XG59XG5cbi8qKiBBIHJlYWRlciB0aGF0IGFsd2F5cyBkZWNsaW5lcywgZm9yY2luZyB0aGUgcGFyc2VyIHRvIHdob2xlLWZpbGUgYW5jaG9ycy4gKi9cbmNvbnN0IG5vUmFuZ2VSZWNvdmVyeSA9ICgpOiBudWxsID0+IG51bGw7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSA9IGNyZWF0ZURpc2tNZW1vU3RvcmVcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQb3N0VG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgdG9vbF9uYW1lID0gaW5wdXQudG9vbF9uYW1lO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcblxuICAgIC8vIFNoZWxsIHRvdWNoOiBleHRyYWN0IHRoZSBjb21tYW5kIGZyb20gd2hpY2hldmVyIGVudmVsb3BlIHNoYXBlIHRoZSBoYXJuZXNzXG4gICAgLy8gZGVsaXZlcnMsIHBhcnNlLCBhbmQgcnVuIGVhY2ggcmVzb2x2ZWQgc3BhbiB0aHJvdWdoIHRoZSBzaGFyZWQgdG91Y2ggY29yZS5cbiAgICAvL1xuICAgIC8vIC0gYEJhc2hgOiB0aGUgaGFybmVzcy11bndyYXBwZWQgc2hhcGUgQ29kZXggXHUyMjY1MC4xNDQgYWN0dWFsbHkgc2VuZHMgXHUyMDE0XG4gICAgLy8gICBgdG9vbF9pbnB1dC5jb21tYW5kYCBpcyB0aGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIChzYW1lIHNoYXBlIHRoZVxuICAgIC8vICAgQ2xhdWRlIGFkYXB0ZXIgaGFuZGxlcykuXG4gICAgLy8gLSBgZXhlY19jb21tYW5kYDogY2xhc3NpYyBmdW5jdGlvbl9jYWxsIGVudmVsb3BlIChjbGkgXHUyMjY0MC4xMzApIFx1MjAxNFxuICAgIC8vICAgYHRvb2xfaW5wdXQuYXJndW1lbnRzYCBpcyBhIEpTT04gc3RyaW5nIHdpdGggYSBgY21kYCBmaWVsZC5cbiAgICAvLyAtIGBleGVjYDogZGlyZWN0IGNvZGUtbW9kZSBlbnZlbG9wZSAobWF5IHNoaXAgaW4gYSBmdXR1cmUgQ0xJKSBcdTIwMTRcbiAgICAvLyAgIGB0b29sX2lucHV0LmlucHV0YCBpcyBKUyBzb3VyY2Ugd3JhcHBpbmcgYHRvb2xzLmV4ZWNfY29tbWFuZCh7Li4ufSlgLlxuICAgIC8vXG4gICAgLy8gQSBjb21tYW5kIHdpdGggbm8gcmVjb2duaXplZCBpZGlvbSB5aWVsZHMgbm8gYmxvY2tzIGFuZCByZXR1cm5zIHVuZGVmaW5lZCBcdTIwMTRcbiAgICAvLyBmYWlsLW9wZW4sIHNhbWUgYXMgdGhlIGFwcGx5X3BhdGNoIHBhdGggYmVsb3cuXG4gICAgaWYgKHRvb2xfbmFtZSA9PT0gJ0Jhc2gnIHx8IHRvb2xfbmFtZSA9PT0gJ2V4ZWNfY29tbWFuZCcgfHwgdG9vbF9uYW1lID09PSAnZXhlYycpIHtcbiAgICAgIGxldCBjb21tYW5kOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIGlmICh0b29sX25hbWUgPT09ICdCYXNoJykge1xuICAgICAgICAvLyBUaGUgaGFybmVzcyBhbHJlYWR5IHVud3JhcHBlZCB0aGUgY29kZS1tb2RlIGVudmVsb3BlIFx1MjAxNCB0aGUgY29tbWFuZCBpc1xuICAgICAgICAvLyBpbiBgdG9vbF9pbnB1dC5jb21tYW5kYCwgZXhhY3RseSBhcyB0aGUgQ2xhdWRlIGFkYXB0ZXIgcmVjZWl2ZXMgaXQuXG4gICAgICAgIGNvbnN0IHJhdyA9IChpbnB1dC50b29sX2lucHV0IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCk/LmNvbW1hbmQ7XG4gICAgICAgIGNvbW1hbmQgPSB0eXBlb2YgcmF3ID09PSAnc3RyaW5nJyA/IHJhdyA6IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb21tYW5kID0gbmFycm93RXhlY0NvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICB9XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCAmJiB0b29sX25hbWUgPT09ICdleGVjJykge1xuICAgICAgICAvLyBDb2RlLW1vZGUgYGV4ZWNgIHdyYXBzIHRoZSBzYW1lIGNhbGwgaW4gSlMgc291cmNlLiBBIG1hdGNoZWQgY2FsbFxuICAgICAgICAvLyB3aG9zZSBhcmd1bWVudCBjb3VsZCBub3QgYmUgcGFyc2VkICh2YXJpYWJsZS90ZW1wbGF0ZS1idWlsdCBjb21tYW5kKVxuICAgICAgICAvLyBpcyBhIGRpc3RpbmN0IG91dGNvbWUgZnJvbSBcIm5vdCBhIGNvZGUtbW9kZSBlbnZlbG9wZSBhdCBhbGxcIjogd2FybiBzb1xuICAgICAgICAvLyB0aGUgYmxpbmQgc3BvdCBpcyB2aXNpYmxlIGluc3RlYWQgb2Ygc2lsZW50bHkgY29uZmxhdGVkIHdpdGggbm8gbWF0Y2guXG4gICAgICAgIGNvbnN0IGNvZGVNb2RlID0gbmFycm93Q29kZU1vZGVFeGVjKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgICBpZiAoY29kZU1vZGUubWF0Y2hlZCAmJiBjb2RlTW9kZS5jbWQgPT09IG51bGwpIHtcbiAgICAgICAgICBjdHgubG9nZ2VyLndhcm4oXG4gICAgICAgICAgICAnQ29kZXggY29kZS1tb2RlIGV4ZWMgZW52ZWxvcGUgbWF0Y2hlZCBidXQgaXRzIGV4ZWNfY29tbWFuZCBhcmd1bWVudCBjb3VsZCBub3QgYmUgcGFyc2VkOyBubyBzaGVsbCB0b3VjaCcsXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHRvb2xJbnB1dFR5cGU6IHR5cGVvZiBpbnB1dC50b29sX2lucHV0LFxuICAgICAgICAgICAgICB0b29sSW5wdXRLZXlzOlxuICAgICAgICAgICAgICAgIGlucHV0LnRvb2xfaW5wdXQgIT09IG51bGwgJiYgdHlwZW9mIGlucHV0LnRvb2xfaW5wdXQgPT09ICdvYmplY3QnXG4gICAgICAgICAgICAgICAgICA/IE9iamVjdC5rZXlzKGlucHV0LnRvb2xfaW5wdXQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgICAgICAgfVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29tbWFuZCA9IGNvZGVNb2RlLmNtZDtcbiAgICAgIH1cbiAgICAgIGlmICghY29tbWFuZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgLy8gQW4gaW50ZXJydXB0ZWQgY29tbWFuZCBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnM7IHRoZVxuICAgICAgLy8gZHJpdmVyIHJlLWNoZWNrcyBkZWZlbnNpdmVseS5cbiAgICAgIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZChpbnB1dC50b29sX3Jlc3BvbnNlKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICAgICAgY29uc3QgYmxvY2tzID0gYXdhaXQgcnVuQmFzaFRvdWNoZXMobWF0Y2hlcywgc2Vzc2lvbklkLCBjd2QsIGlucHV0LnRvb2xfcmVzcG9uc2UsIGV4ZWN1dG9ycywgbWVtbywgKG1lc3NhZ2UpID0+XG4gICAgICAgIGN0eC5sb2dnZXIud2FybihtZXNzYWdlKVxuICAgICAgKTtcbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQsIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmQgPSBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIFN1cHByZXNzIG9ubHkgYSAqY29uZmlybWVkKiBub24tc3VjY2Vzcy4gQW4gdW5yZWNvZ25pemVkIHJlc3BvbnNlIHNoYXBlXG4gICAgLy8gcHJvY2VlZHMgKHdpdGggYSB3YXJuaW5nKSByYXRoZXIgdGhhbiByaXNrIHNraXBwaW5nIGEgcmVhbCBlZGl0J3MgdG91Y2guXG4gICAgY29uc3QgY2xhc3NpZmljYXRpb24gPSBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZShpbnB1dC50b29sX3Jlc3BvbnNlKTtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICdmYWlsdXJlJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoY2xhc3NpZmljYXRpb24gPT09ICd1bmtub3duJykge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdDb2RleCBhcHBseV9wYXRjaCB0b29sX3Jlc3BvbnNlIHNoYXBlIHVucmVjb2duaXplZDsgcnVubmluZyB0b3VjaCBkZWZlbnNpdmVseScsIHtcbiAgICAgICAgdG9vbFJlc3BvbnNlVHlwZTogdHlwZW9mIGlucHV0LnRvb2xfcmVzcG9uc2UsXG4gICAgICAgIHRvb2xSZXNwb25zZUtleXM6XG4gICAgICAgICAgaW5wdXQudG9vbF9yZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSA9PT0gJ29iamVjdCdcbiAgICAgICAgICAgID8gT2JqZWN0LmtleXMoaW5wdXQudG9vbF9yZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilcbiAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBPbmUgZW52ZWxvcGUgbWF5IHRvdWNoIHNldmVyYWwgZmlsZXM7IGZvcmNlIHdob2xlLWZpbGUgYW5jaG9ycyAoQ29kZXggbmV2ZXJcbiAgICAvLyByZWNvdmVycyBhIHBvc3QtZWRpdCByYW5nZSkgYW5kIHJ1biB0aGUgc2hhcmVkIHRvdWNoIGNvcmUgcGVyIHRvdWNoZWQgZmlsZS5cbiAgICAvLyBUaGUgc2hhcmVkIG1lbW8gZGVkdXBlcyBzcGFuIHJlbmRlcnMgYWNyb3NzIGFuY2hvcnMgYW5kIHRoZSBzZXNzaW9uLlxuICAgIGNvbnN0IGFuY2hvcnMgPSBwYXJzZUFwcGx5UGF0Y2goY29tbWFuZCwgbm9SYW5nZVJlY292ZXJ5KTtcbiAgICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgICAgY29uc3QgYWJzUGF0aCA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgYW5jaG9yLnBhdGgpO1xuICAgICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgICAgaWYgKCFzY29wZSkgY29udGludWU7XG4gICAgICAvLyBBIGAqKiogRGVsZXRlIEZpbGU6YCBhbmNob3IgY2FycmllcyB0aGUgYWJzZW50IG1hcmtlciAocGxhbiBcdTAwQTczKTogaXRzXG4gICAgICAvLyB0b3VjaCB0YXJnZXRzIGFic2VuY2UgXHUyMDE0IHRoZSBkZWxldGUgZ2F0ZSB2ZXJpZmllcyB0aGUgcGF0aCBpcyBnb25lIEFORFxuICAgICAgLy8gd2FzIHJlYWwgKGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCkgYmVmb3JlIGZpcmluZy4gRXZlcnl0aGluZyBlbHNlXG4gICAgICAvLyB0YXJnZXRzIGV4aXN0ZW5jZS5cbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgIGN3ZCxcbiAgICAgICAgICBmaWxlUGF0aDogYWJzUGF0aCxcbiAgICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgICB0YXJnZXRTdGF0ZTogYW5jaG9yLmFic2VudCA/ICdhYnNlbnQnIDogJ2V4aXN0cycsXG4gICAgICAgICAgLi4uKGFuY2hvci5hYnNlbnQgPyB7IHBvc3RTdGF0ZTogeyByZWFsRGVsZXRlOiB0cnVlIH0gfSA6IHt9KVxuICAgICAgICB9LFxuICAgICAgICBleGVjdXRvcnMsXG4gICAgICAgIG1lbW9cbiAgICAgICk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cblxuICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCwgc3lzdGVtTWVzc2FnZTogY29tYmluZWQgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdhcHBseV9wYXRjaHxleGVjX2NvbW1hbmR8ZXhlY3xCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUlPLFNBQVMsZ0JBQWdCLFFBQVEsU0FBUztBQUM3QyxTQUFPLGVBQWUsZUFBZSxRQUFRLE9BQU87QUFDeEQ7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QUFrQixFQUFFLG1CQUFtQixVQUFVLGVBQWUsU0FBUyxDQUFDO0FBQUEsRUFDbkY7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyxzQ0FBc0MsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUM5VWxILFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImxvZ2dlciIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAiYmFzZW5hbWUiLCAiam9pbiIsICJleGVjRmlsZVN5bmMiLCAiam9pbiIsICJiYXNlbmFtZSIsICJqb2luIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJiYXNlbmFtZSIsICJleGVjRmlsZVN5bmMiLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImpvaW4iLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAicmVhZEZpbGVTeW5jIiwgInRva2VucyIsICJmcyIsICJ0b1Bvc2l4IiwgImN0eCIsICJyZWNvdmVyUmFuZ2UiLCAiY29tbWFuZCIsICJibG9ja3MiLCAiY29tYmluZWQiXQp9Cg==
