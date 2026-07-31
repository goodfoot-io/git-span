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
        execFileSync3("git", ["span", "stale", resolved.relPath, "--fix"], {
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
    stale: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out;
      try {
        out = execFileSync3("git", ["span", "stale", "--format", "porcelain", ...scoped], {
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
    const cwd = input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);
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
var post_tool_use_default = postToolUseHook({ matcher: "apply_patch", timeout: 1e4 }, createHandler());

// src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb2RleC9hcHBseS1wYXRjaC50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS50cyIsICJzcmMvY29kZXgvcG9zdC10b29sLXVzZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGFkdmlzb3ItY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgYWR2aXNvcidzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgYWR2aXNvciBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgYWR2aXNvciBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGFkdmlzb3IgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBhZHZpc29yIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGFkdmlzb3IncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhZHZpc29yTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2Fkdmlzb3InKTtcbn1cbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgc3Bhbi1zdXJmYWNpbmcgY29yZS5cbiAqXG4gKiBHaXZlbiBhbiBhbHJlYWR5LXJlc29sdmVkIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgYSBsaW5lIHJhbmdlLCB0aGlzIG1vZHVsZVxuICogcnVucyB0aGUgc2hhcmVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCAvIGAuaG9va2lnbm9yZWAgLyBzZXNzaW9uLW1lbW8gL1xuICogYGdpdCBzcGFuIHN0YWxlYCBwaXBlbGluZSBhbmQgYXNzZW1ibGVzIHRoZSBodW1hbi1yZWFkYWJsZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YFxuICogYmxvY2sgdGhhdCBib3RoIGFkYXB0ZXJzIHN1cmZhY2UgaW5saW5lIGJlZm9yZSBhbiBlZGl0LiBJdCBpbXBvcnRzIG5vdGhpbmdcbiAqIGZyb20gZWl0aGVyIGhvb2sgU0RLOiB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCBhIHJhbmdlIGRlcml2ZWQgZnJvbVxuICogYGZpbGVfcGF0aGAvYG9mZnNldGAvYG9sZF9zdHJpbmdgOyB0aGUgQ29kZXggUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IHRoZVxuICogcmFuZ2VzIHJlY292ZXJlZCBmcm9tIGFuIGBhcHBseV9wYXRjaGAgZW52ZWxvcGUuIEVhY2ggYWRhcHRlciB3cmFwcyB0aGVcbiAqIHJldHVybmVkIGJsb2NrIHN0cmluZyBpbiBpdHMgb3duIFNESyBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBUaGUgZXhlY3V0b3Ivc3RhbGUvbWVtbyBkZXBlbmRlbmNpZXMgYXJlIGluamVjdGVkIHNvIHRoZSBwaXBlbGluZSBpcyB0ZXN0YWJsZVxuICogd2l0aCBmYWtlcyBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZSBzaGFyZWQga2VybmVsLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBpc0dpdElnbm9yZWQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHBydW5lU3RhbGVTZXNzaW9ucyxcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3QsXG4gIHNlc3Npb25EaXIsXG4gIHRvUG9zaXhcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgdHlwZSBIb29rSWdub3JlTG9hZGVyLCBpc1NwYW5TdXBwcmVzc2VkIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbi8qKlxuICogTWluaW1hbCBsb2dnZXIgc3VyZmFjZSB0aGUgYGNvbW1vbi9gIGxheWVyIGxvZ3MgdGhyb3VnaDsgYm90aCBTREsgbG9nZ2Vyc1xuICogc2F0aXNmeSBpdC4gYHdhcm5gIGlzIHJlcXVpcmVkIFx1MjAxNCBldmVyeSBleGlzdGluZyBjYWxsIHNpdGUgcmVwb3J0cyBhIGZhaWx1cmUuXG4gKiBgaW5mb2AgaXMgb3B0aW9uYWwgc28gYSBmYWtlIGNhcnJ5aW5nIG9ubHkgYHdhcm5gIHN0aWxsIHNhdGlzZmllcyB0aGVcbiAqIGludGVyZmFjZTogaXQgZXhpc3RzIGZvciB0aGUgZGlhZ25vc3RpYyBicmVhZGNydW1icyBhICpzdWNjZXNzZnVsKiBydW4gbGVhdmVzXG4gKiBiZWhpbmQgKGFkdmlzb3ItY29yZSdzIGNodXJuLXN1cHByZXNzaW9uIGNvdW50KSwgd2hpY2ggYXJlIG5vdCB3YXJuaW5ncyBhbmRcbiAqIG11c3Qgbm90IHJlYWQgYXMgZmFpbHVyZXMgaW4gdGhlIGhvb2sgbG9nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvcmVMb2dnZXIge1xuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbiAgaW5mbz8obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNwYW4gZXhlY3V0b3IgYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEV4ZWN1dGVzIGBnaXQgc3BhbiBsaXN0YCB3aXRoIGdpdmVuIGFyZ3MgaW4gYSBnaXZlbiBjd2QuXG4gKiBSZXR1cm5zIHN0ZG91dCBzdHJpbmcuIFRocm93cyBvbiBub24temVybyBleGl0LlxuICovXG5leHBvcnQgdHlwZSBTcGFuRXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0U3BhbkV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFNwYW5FeGVjdXRvciB7XG4gIHJldHVybiAoYXJncywgY3dkKSA9PiB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAuLi5hcmdzXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICB9O1xufVxuXG4vKipcbiAqIFJ1bnMgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbiA8c2x1Z3M+YCBhbmQgcmV0dXJucyBpdHMgcG9yY2VsYWluIHN0ZG91dCBcdTIwMTRcbiAqIG9uZSByb3cgcGVyICpkcmlmdGVkKiBhbmNob3IgYW1vbmcgdGhlIGdpdmVuIHNwYW5zLCBlbXB0eSB3aGVuIGFsbCBhcmUgY2xlYW4uXG4gKiBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIDAgaW4gcG9yY2VsYWluIG1vZGUgd2hldGhlciBvciBub3QgZHJpZnQgZXhpc3RzLCBidXQgd2VcbiAqIHN0aWxsIGNhcHR1cmUgc3Rkb3V0IGZyb20gYSB0aHJvd24gZXJyb3Igc28gYSBkcmlmdCBzaWduYWwgaXMgbmV2ZXIgbG9zdCB0byBhXG4gKiBub24temVybyBleGl0LiBUaHJvd3Mgb25seSB3aGVuIG5vIHN0ZG91dCBpcyBhdmFpbGFibGUgKGdlbnVpbmUgZmFpbHVyZSkuXG4gKi9cbmV4cG9ydCB0eXBlIFN0YWxlRXhlY3V0b3IgPSAoc2x1Z3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFN0YWxlRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3RhbGVFeGVjdXRvciB7XG4gIHJldHVybiAoc2x1Z3MsIGN3ZCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2x1Z3NdLCB7XG4gICAgICAgIGN3ZCxcbiAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3Qgb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICBpZiAodHlwZW9mIG91dCA9PT0gJ3N0cmluZycpIHJldHVybiBvdXQ7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gbWVtbyBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVtb1N0b3JlIHtcbiAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPjtcbiAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcsIG5hbWVzOiBzdHJpbmdbXSk6IHZvaWQ7XG59XG5cbi8vIExpdmVzIHVuZGVyIHRoZSBzaGFyZWQgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IChhZ2VudC1ob29rcy1jb21tb24udHMnc1xuLy8gc2Vzc2lvbkRpcikgXHUyMDE0IHJlbG9jYXRlZCBmcm9tIG9zLnRtcGRpcigpL2FnZW50LWhvb2tzLWdpdC1zcGFuLyBzb1xuLy8gcGVyLXNlc3Npb24gc3RhdGUgaGFzIG9uZSBob21lIGFuZCBpcyBjb3ZlcmVkIGJ5IHBydW5lU3RhbGVTZXNzaW9ucydzXG4vLyBvcHBvcnR1bmlzdGljID4zMC1kYXkgcHJ1bmluZy5cbmZ1bmN0aW9uIG1lbW9GaWxlUGF0aChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHNlc3Npb25EaXIoc2Vzc2lvbklkKSwgJ3RvdWNoLW1lbW8uanNvbicpO1xufVxuXG5leHBvcnQgdHlwZSBNZW1vTG9nZ2VyID0gQ29yZUxvZ2dlcjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRTdXJmYWNlZChzZXNzaW9uSWQpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmF3ID0gZnMucmVhZEZpbGVTeW5jKG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpLCAndXRmOCcpO1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgeyBzdXJmYWNlZD86IHVua25vd24gfTtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkLnN1cmZhY2VkKSkge1xuICAgICAgICAgIHJldHVybiBuZXcgU2V0KHBhcnNlZC5zdXJmYWNlZCBhcyBzdHJpbmdbXSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyByZWFkIGZhaWxlZCAodHJlYXRpbmcgYXMgZW1wdHkpJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFNldCgpO1xuICAgIH0sXG4gICAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCBuYW1lcykge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgICAgIGZvciAoY29uc3QgbiBvZiBuYW1lcykgZXhpc3RpbmcuYWRkKG4pO1xuICAgICAgY29uc3QgbWVtb0RpciA9IHNlc3Npb25EaXIoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IG1lbW9QYXRoID0gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCB0bXBQYXRoID0gYCR7bWVtb1BhdGh9LnRtcGA7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMobWVtb0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmModG1wUGF0aCwgSlNPTi5zdHJpbmdpZnkoeyBzdXJmYWNlZDogWy4uLmV4aXN0aW5nXSB9KSwgJ3V0ZjgnKTtcbiAgICAgICAgZnMucmVuYW1lU3luYyh0bXBQYXRoLCBtZW1vUGF0aCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gd3JpdGUgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG4vKiogRmFjdG9yeSBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgYSBNZW1vU3RvcmUgZ2l2ZW4gYSBsb2dnZXIuICovXG5leHBvcnQgdHlwZSBNZW1vRmFjdG9yeSA9IChsb2dnZXI6IE1lbW9Mb2dnZXIpID0+IE1lbW9TdG9yZTtcblxuLyoqIERlZmF1bHQgZGlzay1iYWNrZWQgbWVtbyBmYWN0b3J5IHVzZWQgaW4gcHJvZHVjdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNrTWVtb0ZhY3RvcnkobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBzY29wZSByZXNvbHV0aW9uIChyZXBvLXNjb3BpbmcgKyBnaXRpZ25vcmUgKyBzcGFuLXJvb3QgZ3VhcmRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hTY29wZSB7XG4gIHJlcG9Sb290OiBzdHJpbmc7XG4gIHJlcG9SZWxQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQm91bmQgYSB0b3VjaGVkIGZpbGUgdG8gdGhlIENXRCByZXBvLiBSZXNvbHZlIHRoZSByZXBvIHJvb3Qgb2YgdGhlIGN1cnJlbnRcbiAqIHdvcmtpbmcgZGlyZWN0b3J5IGFuZCByZXF1aXJlIHRoZSB0b3VjaGVkIGZpbGUgdG8gcmVzb2x2ZSB0byB0aGUgU0FNRSByZXBvXG4gKiByb290OyBkcm9wIGZpbGVzIGluIGEgZGlmZmVyZW50IHJlcG9zaXRvcnkvd29ya3RyZWUsIGdpdGlnbm9yZWQgZmlsZXMsIGFuZFxuICogZmlsZXMgdW5kZXIgdGhlIHNwYW4gcm9vdC4gUmV0dXJucyB0aGUgcmVzb2x2ZWQgYHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH1gXG4gKiBvciBudWxsIHdoZW4gdGhlIHRvdWNoIGlzIG91dCBvZiBzY29wZS5cbiAqXG4gKiBDb21wYXJpbmcgcmVzb2x2ZWQgYGdpdCAtLXNob3ctdG9wbGV2ZWxgIHRvcGxldmVscyAobm90IHBhdGggcHJlZml4ZXMpXG4gKiBkaXN0aW5ndWlzaGVzIHNlcGFyYXRlIHJlcG9zIGFuZCB3b3JrdHJlZXMgYW5kIGlzIHJvYnVzdCB0byBzeW1saW5rcy4gRmFpbFxuICogY2xvc2VkOiBpZiB0aGUgQ1dEIHJlcG8gY2FuJ3QgYmUgcmVzb2x2ZWQsIHRoZSB0b3VjaCBpcyBkcm9wcGVkIHJhdGhlciB0aGFuXG4gKiBmYWxsaW5nIGJhY2sgdG8gdGhlIGZpbGUncyBvd24gcmVwby5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUb3VjaFNjb3BlKGN3ZDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBUb3VjaFNjb3BlIHwgbnVsbCB7XG4gIGNvbnN0IGN3ZFJlcG9Sb290ID0gY3dkID8gcmVzb2x2ZVJlcG9Sb290KGN3ZCkgOiBudWxsO1xuICBpZiAoIWN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBhYnNEaXIgPSB0b1Bvc2l4KG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpO1xuICBjb25zdCBmaWxlUmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoYWJzRGlyKTtcbiAgaWYgKGZpbGVSZXBvUm9vdCAhPT0gY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHJlcG9Sb290ID0gY3dkUmVwb1Jvb3Q7XG4gIGNvbnN0IHJlcG9SZWxQYXRoID0gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGFic1BhdGgpO1xuXG4gIC8vIFNraXAgZ2l0aWdub3JlZCBmaWxlcyBlbnRpcmVseS4gQnVpbGQgb3V0cHV0LCBjYWNoZXMsIGFuZCBsb2dzIGFyZSBub3RcbiAgLy8gc3Bhbi1yZWxldmFudDogdGhleSBtdXN0IG5ldmVyIHN1cmZhY2Ugc3BhbiBvdmVybGFwcy5cbiAgaWYgKGlzR2l0SWdub3JlZChyZXBvUm9vdCwgcmVwb1JlbFBhdGgpKSByZXR1cm4gbnVsbDtcblxuICAvLyBTa2lwIHNwYW4gZG9jdW1lbnRzIGVudGlyZWx5LiBGaWxlcyB1bmRlciB0aGUgcmVzb2x2ZWQgc3BhbiByb290IGFyZSBtYW5hZ2VkXG4gIC8vIGJ5IGdpdCBzcGFuIGl0c2VsZiBhbmQgYXJlIG5vdCBhcHBsaWNhdGlvbiBzb3VyY2VzIHRoYXQgbmVlZCBzcGFuIGNvdmVyYWdlLlxuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIGlmIChpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoLCBzcGFuUm9vdCkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN1cmZhY2Ugcm91dGluZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBJbmplY3RlZCBkZXBlbmRlbmNpZXMgZm9yIHtAbGluayBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc30uICovXG5leHBvcnQgaW50ZXJmYWNlIFN1cmZhY2VEZXBzIHtcbiAgZXhlY3V0b3I6IFNwYW5FeGVjdXRvcjtcbiAgc3RhbGVFeGVjdXRvcjogU3RhbGVFeGVjdXRvcjtcbiAgbWVtbzogTWVtb1N0b3JlO1xuICBsb2FkUnVsZXM6IEhvb2tJZ25vcmVMb2FkZXI7XG4gIGxvZ2dlcjogQ29yZUxvZ2dlcjtcbn1cblxuLyoqXG4gKiBHaXZlbiBhIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgdGhlIGxpbmUgcmFuZ2UgYmVpbmcgdG91Y2hlZCB3aXRoaW4gYW5cbiAqIGFscmVhZHktcmVzb2x2ZWQgcmVwbywgcHJvZHVjZSB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZVxuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhhdCByYW5nZSwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gc3VyZmFjZS5cbiAqXG4gKiBUaGUgcGlwZWxpbmU6IGBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpbmAgXHUyMTkyIGtlZXAgbGluZS1yYW5nZWQgYW5jaG9ycyBvblxuICogdGhlIHNhbWUgZmlsZSB0aGF0IGludGVyc2VjdCB0aGUgcmFuZ2UgYW5kIGFyZSBub3QgYC5ob29raWdub3JlYC1zdXBwcmVzc2VkIFx1MjE5MlxuICogZHJvcCBzbHVncyBhbHJlYWR5IHN1cmZhY2VkIHRoaXMgc2Vzc2lvbiAobWVtbykgXHUyMTkyIHJlbmRlciBgZ2l0IHNwYW4gbGlzdFxuICogPG5hbWVzXHUyMDI2PmAgXHUyMTkyIGFwcGVuZCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlciBmb3IgYW55IGFscmVhZHktc3RhbGVcbiAqIHNwYW4uIE9uIHN1Y2Nlc3MgdGhlIHN1cmZhY2VkIG5hbWVzIGFyZSByZWNvcmRlZCBpbiB0aGUgbWVtby4gRXhlY3V0b3IgYW5kXG4gKiBzdGFsZS1wcm9iZSBmYWlsdXJlcyBhcmUgbG9nZ2VkIGFuZCBkZWdyYWRlIHRvIG51bGwgLyB0aGUgcGxhaW4gYmxvY2s7IHRoZXlcbiAqIG5ldmVyIHRocm93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VyZmFjZU92ZXJsYXBwaW5nU3BhbnMoXG4gIGRlcHM6IFN1cmZhY2VEZXBzLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICByZXBvUmVsUGF0aDogc3RyaW5nLFxuICByYW5nZTogTGluZVJhbmdlLFxuICBzZXNzaW9uSWQ6IHN0cmluZ1xuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHsgZXhlY3V0b3IsIHN0YWxlRXhlY3V0b3IsIG1lbW8sIGxvYWRSdWxlcywgbG9nZ2VyIH0gPSBkZXBzO1xuXG4gIC8vIEZpbHRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpblxuICBsZXQgcG9yY2VsYWluU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcG9yY2VsYWluU3Rkb3V0ID0gZXhlY3V0b3IoWyctLXBvcmNlbGFpbicsIHJlcG9SZWxQYXRoXSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIFBhdGgtc2NvcGVkIHN1cHByZXNzaW9uOiBhIHJlcG8ncyAuc3Bhbi8uaG9va2lnbm9yZSBjYW4gaG9sZCBiYWNrIHNwYW4gc2x1Z1xuICAvLyBwcmVmaXhlcyBmb3IgYW5jaG9ycyB1bmRlciBnaXZlbiBwYXRocy4gQSBzdXBwcmVzc2VkIHNwYW4gaXMgbmV2ZXIgc3VyZmFjZWQuXG4gIGNvbnN0IGlnbm9yZVJ1bGVzID0gbG9hZFJ1bGVzKHJlcG9Sb290KTtcblxuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IHBhcnNlUG9yY2VsYWluKHBvcmNlbGFpblN0ZG91dCk7XG4gIGNvbnN0IGNhbmRpZGF0ZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBpZiAocm93LnBhdGggIT09IHJlcG9SZWxQYXRoKSBjb250aW51ZTtcbiAgICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIGNvbnRpbnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICAgIGlmICghcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KSkgY29udGludWU7XG4gICAgaWYgKGlzU3BhblN1cHByZXNzZWQoaWdub3JlUnVsZXMsIHJvdy5wYXRoLCByb3cubmFtZSkpIGNvbnRpbnVlO1xuICAgIGNhbmRpZGF0ZU5hbWVzLmFkZChyb3cubmFtZSk7XG4gIH1cblxuICBpZiAoY2FuZGlkYXRlTmFtZXMuc2l6ZSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gU3VidHJhY3QgYWxyZWFkeS1zdXJmYWNlZCBuYW1lc1xuICBjb25zdCBzdXJmYWNlZCA9IG1lbW8uZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgY29uc3QgdG9TdXJmYWNlID0gWy4uLmNhbmRpZGF0ZU5hbWVzXS5maWx0ZXIoKG4pID0+ICFzdXJmYWNlZC5oYXMobikpLnNvcnQoKTtcbiAgaWYgKHRvU3VyZmFjZS5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFJlbmRlciBwYXNzOiBnaXQgc3BhbiBsaXN0IDxuYW1lMT4gPG5hbWUyPiAuLi5cbiAgbGV0IHJlbmRlclN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlbmRlclN0ZG91dCA9IGV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gbGlzdCAocmVuZGVyKSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE9mIHRoZSBzcGFucyBiZWluZyBzdXJmYWNlZCwgZmxhZyBhbnkgYWxyZWFkeSBzdGFsZSBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgc3RhbGVuZXNzIGlzIG5vbi1mYXRhbDogZmFsbCBiYWNrIHRvIHRoZSBwbGFpbiBibG9jay5cbiAgbGV0IHN0YWxlSGludCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IHN0YWxlTmFtZXMgPSBuZXcgU2V0KHBhcnNlU3RhbGVQb3JjZWxhaW4oc3RhbGVFeGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KSkubWFwKChyKSA9PiByLm5hbWUpKTtcbiAgICBjb25zdCBzdGFsZVN1cmZhY2VkID0gdG9TdXJmYWNlLmZpbHRlcigobikgPT4gc3RhbGVOYW1lcy5oYXMobikpO1xuICAgIGlmIChzdGFsZVN1cmZhY2VkLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gc3RhbGVTdXJmYWNlZC5tYXAoKG4pID0+IGAgIGdpdCBzcGFuIGhpc3RvcnkgJHtufWApLmpvaW4oJ1xcbicpO1xuICAgICAgc3RhbGVIaW50ID0gYFxcblN0YWxlIFx1MjAxNCB0aGUgbGluZXMgeW91J3JlIHRvdWNoaW5nIGhhdmUgZHJpZnRlZCBmcm9tIHRoZXNlIHNwYW5zJyBhbmNob3JlZCBzdGF0ZS4gUmV2aWV3IGhvdyBlYWNoIHN1YnN5c3RlbSBldm9sdmVkIGJlZm9yZSBjaGFuZ2luZyBpdDpcXG4ke2xpbmVzfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gc3RhbGUgKGhpc3RvcnkgaGludCkgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gYFxcbjxnaXQtc3Bhbj5cXG4ke3JlbmRlclN0ZG91dH0ke3N0YWxlSGludH1cXG48L2dpdC1zcGFuPlxcbmA7XG5cbiAgLy8gVXBkYXRlIG1lbW9cbiAgbWVtby5hZGRTdXJmYWNlZChzZXNzaW9uSWQsIHRvU3VyZmFjZSk7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IGl0IGlzIG5ldmVyIHN1cmZhY2VkIGluIHRoZSBpbmxpbmVcbiAqIGA8Z2l0LXNwYW4+YCBibG9jayB0aGUgYFBvc3RUb29sVXNlYCB0b3VjaCBob29rIGVtaXRzLiBJdCBoYXMgbm8gZWZmZWN0IG9uXG4gKiB0aGUgYFByZVRvb2xVc2VgIGFkdmlzb3IsIHdob3NlIG93biB1bmNvdmVyZWQtd3JpdGVzIHN1cHByZXNzaW9uIGxpdmVzIGluXG4gKiBgLnNwYW4vLmFkdmlzb3JpZ25vcmVgIChzZWUgYGFkdmlzb3ItaWdub3JlLnRzYCkuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuYWR2aXNvcmlnbm9yZWBcbiAqIGluIGBhZHZpc29yLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyB0b3VjaC1ob29rIGNvcmUuXG4gKlxuICogVGhpcyBtb2R1bGUgaW1wbGVtZW50cyB0aGUgUG9zdFRvb2xVc2UgXCJ0b3VjaCBzaWduYWxcIiB0aGF0IGJvdGggdGhlIENsYXVkZVxuICogKGBSZWFkfEVkaXR8V3JpdGVgKSBhbmQgQ29kZXggKGBhcHBseV9wYXRjaGApIGFkYXB0ZXJzIGRyaXZlLiBJdCBpbXBvcnRzXG4gKiBub3RoaW5nIGZyb20gZWl0aGVyIGhvb2sgU0RLIGFuZCBpcyB0eXBlZCBzdHJ1Y3R1cmFsbHksIHBlciB0aGUgYGNvbW1vbi9gXG4gKiBsYXllciBjb252ZW50aW9uOiBhZGFwdGVycyB0cmFuc2xhdGUgdGhlaXIgU0RLLXNwZWNpZmljIGhvb2sgaW5wdXQgaW50byBhXG4gKiB7QGxpbmsgVG91Y2hJbnB1dH0sIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgd3JhcCB0aGUgcmV0dXJuZWRcbiAqIHtAbGluayBUb3VjaE91dHB1dH0gaW4gdGhlaXIgb3duIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCArXG4gKiBgUG9yY2VsYWluU3RhdHVzYC9gU3RhbGVQb3JjZWxhaW5Sb3dgL2BQb3JjZWxhaW5Sb3dgL2BwYXJzZVBvcmNlbGFpbmAvXG4gKiBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGByYW5nZXNJbnRlcnNlY3RgIGFuZCB0aGVcbiAqIHJlcG8vc3Bhbi1yb290IHBhdGggdXRpbGl0aWVzIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBhbmQgdGhlIGBNZW1vU3RvcmVgXG4gKiBjYWRlbmNlIHN0b3JlIChzcGFuLXN1cmZhY2UudHMpLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGh1bWFuU3RhdHVzTGFiZWwsXG4gIGlzRGVidCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGNvbGxhcHNlQnlQYXRoLCB0eXBlIFJhbmdlTGFiZWwsIHJlbmRlckFuY2hvclRyZWUgfSBmcm9tICcuL2FuY2hvci10cmVlLmpzJztcbmltcG9ydCB0eXBlIHsgTWVtb1N0b3JlIH0gZnJvbSAnLi9zcGFuLXN1cmZhY2UuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3QtZWRpdCByYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU3BsaXQgd3JpdHRlbiBjb250ZW50IGludG8gdGhlIGxpbmVzIHRvIGxvY2F0ZSBvbiBkaXNrLiBBIHNpbmdsZSB0cmFpbGluZ1xuICogbmV3bGluZSBpcyBkcm9wcGVkIHNvIGBcImFcXG5iXFxuXCJgIGFuZCBgXCJhXFxuYlwiYCBsb2NhdGUgaWRlbnRpY2FsbHk7IGFuIGVtcHR5XG4gKiAob3IgbmV3bGluZS1vbmx5KSB3cml0ZSBoYXMgbm8gbG9jYXRhYmxlIGJsb2NrLlxuICovXG5mdW5jdGlvbiB0b05lZWRsZUxpbmVzKHdyaXR0ZW46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IHRyaW1tZWQgPSB3cml0dGVuLmVuZHNXaXRoKCdcXG4nKSA/IHdyaXR0ZW4uc2xpY2UoMCwgLTEpIDogd3JpdHRlbjtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIHJldHVybiB0cmltbWVkLnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSBsaW5lIHJhbmdlIHRoYXQgd3JpdHRlbiBjb250ZW50IG5vdyBvY2N1cGllcyBpbiB0aGUgb24tZGlzayBmaWxlLFxuICogZm9yIGFuY2hvcmluZyB0aGUgdG91Y2hlZCByZWdpb24gYWZ0ZXIgYW4gZWRpdCBoYXMgYWxyZWFkeSBhcHBsaWVkLlxuICpcbiAqIFRoaXMgZ2VuZXJhbGl6ZXMgdGhlIHByZS1lZGl0IGBsb2NhdGVDaHVuaygpYCB0ZWNobmlxdWUgaW5cbiAqIFthcHBseS1wYXRjaC50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY29kZXgvYXBwbHktcGF0Y2gudHMjTDI1My1MMjg2KVxuICogKHByZXZpb3VzbHkgQ29kZXgtb25seSkgaW50byBhIHNoYXJlZCBwb3N0LWVkaXQgcHJpbWl0aXZlIGJvdGggaGFybmVzc2VzIHVzZTpcbiAqIHNwbGl0IGB3cml0dGVuYCBhbmQgYG9uRGlza0NvbnRlbnRgIGludG8gbGluZXMgYW5kIGxvY2F0ZSB0aGUgd3JpdHRlbiBibG9jayBhc1xuICogYSBjb250aWd1b3VzIHJ1biBpbnNpZGUgdGhlIG9uLWRpc2sgbGluZXMuXG4gKlxuICogLSBBIHNpbmdsZSBjb250aWd1b3VzIG1hdGNoIHlpZWxkcyBpdHMgMS1iYXNlZCBpbmNsdXNpdmUge0BsaW5rIExpbmVSYW5nZX0uXG4gKiAtIFdoZW4gdGhlIGJsb2NrIGlzIGFic2VudCwgb3IgYXBwZWFycyBtb3JlIHRoYW4gb25jZSAoY29udGV4dCB0byBkaXNhbWJpZ3VhdGVcbiAqICAgaXMgbm90IGF2YWlsYWJsZSBwb3N0LWVkaXQpLCByZWNvdmVyeSBpcyBhbWJpZ3VvdXMgYW5kIHRoZSByZXN1bHQgZGVncmFkZXNcbiAqICAgdG8gYCd3aG9sZS1maWxlJ2AgKHRoZSBzYW1lIGZhbGxiYWNrIGBsb2NhdGVDaHVuaygpYCBzaWduYWxzIHdpdGggYG51bGxgKS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGFuIHVubG9jYXRhYmxlIHdyaXRlIGlzIGEgYCd3aG9sZS1maWxlJ2AgYW5zd2VyLCBub3QgYW4gZXJyb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvdmVyUmFuZ2Uod3JpdHRlbjogc3RyaW5nLCBvbkRpc2tDb250ZW50OiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBjb25zdCBuZWVkbGUgPSB0b05lZWRsZUxpbmVzKHdyaXR0ZW4pO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcblxuICBjb25zdCBoYXlzdGFjayA9IG9uRGlza0NvbnRlbnQuc3BsaXQoJ1xcbicpO1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgY29uc3Qgc3RhcnRzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykge1xuICAgICAgc3RhcnRzLnB1c2goaSk7XG4gICAgICBpZiAoc3RhcnRzLmxlbmd0aCA+IDEpIGJyZWFrOyAvLyBkdXBsaWNhdGVkIFx1MjE5MiBhbWJpZ3VvdXMsIHN0b3AgZWFybHlcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiB7IHN0YXJ0OiBzdGFydHNbMF0gKyAxLCBlbmQ6IHN0YXJ0c1swXSArIG5lZWRsZS5sZW5ndGggfTtcbiAgfVxuICByZXR1cm4gJ3dob2xlLWZpbGUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGlucHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXaGljaCBoYXJuZXNzIGV2ZW50IGZpcmVkLCBhcyB0aGUgdG91Y2ggY29yZSBzZWVzIGl0LiBUaGUgY29yZSBicmFuY2hlcyBvblxuICogdGhpczogYHdyaXRlYCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUgYW5kIG1heSBzdXJmYWNlIGFcbiAqIG1lcmdlZCBibG9jazsgYHJlYWRgIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUgYW5kIGZpbHRlcnMgcG9zaXRpb25hbCBzdGF0dXNlc1xuICogb3V0IG9mIHdoYXQgaXQgc3VyZmFjZXMuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRXZlbnRLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJztcblxuLyoqIEZpZWxkcyBzaGFyZWQgYnkgZXZlcnkgdG91Y2gsIHJlZ2FyZGxlc3Mgb2Yga2luZC4gKi9cbmludGVyZmFjZSBUb3VjaElucHV0QmFzZSB7XG4gIC8qKiBIYXJuZXNzIHNlc3Npb24gaWQgXHUyMDE0IGtleXMgdGhlIHBlci1zZXNzaW9uIGNhZGVuY2Uge0BsaW5rIE1lbW9TdG9yZX0uICovXG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICAvKipcbiAgICogV29ya2luZyBkaXJlY3RvcnkgdGhlIHRvb2wgcmFuIGluLCB1c2VkIHRvIGJvdW5kIHRoZSB0b3VjaCB0byB0aGUgQ1dEIHJlcG9cbiAgICogdmlhIGByZXNvbHZlVG91Y2hTY29wZSgpYCBiZWZvcmUgYW55IHNwYW4gaW52b2NhdGlvbi5cbiAgICovXG4gIGN3ZDogc3RyaW5nO1xuICAvKiogQWJzb2x1dGUsIGNhbm9uaWNhbGl6ZWQgcGF0aCBvZiB0aGUgdG91Y2hlZCBmaWxlLiAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xufVxuXG4vKiogQSByZWFkIHRvdWNoIChDbGF1ZGUgYFJlYWRgLCBvciBhIHJlYWQtc2hhcGVkIENvZGV4IGV2ZW50KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hSZWFkSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICdyZWFkJztcbiAgLyoqXG4gICAqIDEtYmFzZWQgc3RhcnRpbmcgbGluZSBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYG9mZnNldGBcbiAgICogaW5wdXQuIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBvZmZzZXRgIChyZWFkcyBmcm9tIGxpbmUgMSkuXG4gICAqL1xuICBvZmZzZXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBMaW5lIGNvdW50IG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgbGltaXRgIGlucHV0LlxuICAgKiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgbGltaXRgIFx1MjAxNCBzZWUge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH1cbiAgICogZm9yIGhvdyB0aGUgcmFuZ2UgaXMgY29tcHV0ZWQgaW4gdGhhdCBjYXNlLlxuICAgKi9cbiAgbGltaXQ/OiBudW1iZXI7XG59XG5cbi8qKiBBIHdyaXRlIHRvdWNoIChDbGF1ZGUgYEVkaXRgL2BXcml0ZWAsIENvZGV4IGBhcHBseV9wYXRjaGApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFdyaXRlSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICd3cml0ZSc7XG4gIC8qKlxuICAgKiBUaGUgY29udGVudCBqdXN0IHdyaXR0ZW4gdG8gYGZpbGVQYXRoYCwgZmVkIHRvIHtAbGluayByZWNvdmVyUmFuZ2V9IHRvXG4gICAqIHJlLWFuY2hvciB0aGUgdG91Y2hlZCByZWdpb24gYWdhaW5zdCB0aGUgaGVhbGVkIG9uLWRpc2sgZmlsZS4gRm9yIGFcbiAgICogd2hvbGUtZmlsZSBjcmVhdGUgdGhpcyBpcyB0aGUgZW50aXJlIGZpbGUgYm9keTsgYW4gZW1wdHkgc3RyaW5nIG1lYW5zXG4gICAqIFwibm8gbG9jYXRhYmxlIGJsb2NrXCIgYW5kIHRoZSB0b3VjaCBpcyBzY29wZWQgZmlsZS13aWRlLlxuICAgKi9cbiAgd3JpdHRlbjogc3RyaW5nO1xufVxuXG4vKiogVGhlIGhhcm5lc3MtYWdub3N0aWMgdG91Y2ggdGhlIGNvcmUgY29uc3VtZXMuICovXG5leHBvcnQgdHlwZSBUb3VjaElucHV0ID0gVG91Y2hSZWFkSW5wdXQgfCBUb3VjaFdyaXRlSW5wdXQ7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBzdGFsZSA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoU3RhbGVFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8U3RhbGVQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBzdGFsZTogVG91Y2hTdGFsZUV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYWNyb3NzIHRoZSBhbmNob3JzIGJlZm9yZSBjb21taXR0aW5nIFx1MjAxNCBkb2NzIGZvbGxvdyBkZWxpYmVyYXRlbHkgY29tbWl0dGVkIGNvZGUgXHUyMDE0IHRoZW4gcmVmcmVzaDogXFxgZ2l0IHNwYW4gYWRkICR7bmFtZX0gPHBhdGgjTHN0YXJ0LUxlbmQ+XFxgIC8gXFxgZ2l0IHNwYW4gd2h5ICR7bmFtZX0gXCIuLi5cIlxcYCBcdTIwMTQgYW5kIGNoZWNrIHRoZSBvdGhlciBhbmNob3JzIGZvciBrbm9jay1vbiBjaGFuZ2VzLiBJZiB0aGUgZml4IG5lZWRzIGEgY29kZSBjaGFuZ2Ugb3IgdGhlIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGVsbCB0aGUgdXNlciBpbnN0ZWFkLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuIGFib3ZlOiByZXN0b3JlIGFncmVlbWVudCBhY3Jvc3MgdGhlIGFuY2hvcnMgYmVmb3JlIGNvbW1pdHRpbmcgXHUyMDE0IGRvY3MgZm9sbG93IGRlbGliZXJhdGVseSBjb21taXR0ZWQgY29kZSBcdTIwMTQgdGhlbiByZWZyZXNoOiBgZ2l0IHNwYW4gYWRkIDxuYW1lPiA8cGF0aCNMc3RhcnQtTGVuZD5gIC8gYGdpdCBzcGFuIHdoeSA8bmFtZT4gXCIuLi5cImAgXHUyMDE0IGFuZCBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycyBmb3Iga25vY2stb24gY2hhbmdlcy4gSWYgYSBmaXggbmVlZHMgYSBjb2RlIGNoYW5nZSBvciBhIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGVsbCB0aGUgdXNlciBpbnN0ZWFkLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGV4ZWN1dG9ycy5zdGFsZShbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBzdGFsZUJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBTdGFsZVBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBzdGFsZVJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gc3RhbGVCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBzdGFsZUJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuU3RhbGUgPSBzdGFsZUJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuU3RhbGUuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5TdGFsZS5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHJ1biBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBzdGFsZSA8ZmlsZT4gLS1maXhgKSBzY29wZWRcbiAqICAgdG8gdGhlIHRvdWNoZWQgZmlsZSB0byBoZWFsIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSwgdGhlblxuICogICBjb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGFnYWluc3QgdGhlIGhlYWxlZCBhbmNob3JzLCByZW5kZXJpbmdcbiAqICAgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoIGFueSByZW1haW5pbmdcbiAqICAgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzIGRlZHVwZWQgdGhyb3VnaFxuICogICBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmVcbik6IFByb21pc2U8VG91Y2hPdXRwdXQ+IHtcbiAgbGV0IHRyZWVNb2RpZmllZCA9IGZhbHNlO1xuICB0cnkge1xuICAgIGxldCByYW5nZTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnID0gJ3dob2xlLWZpbGUnO1xuICAgIGlmIChpbnB1dC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICBjb25zdCBmaXggPSBhd2FpdCBleGVjdXRvcnMuZml4KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICAgICAgdHJlZU1vZGlmaWVkID0gZml4Lm1vZGlmaWVkO1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmFuZ2VGcm9tRGlzayhpbnB1dC53cml0dGVuLCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJlYWRSYW5nZShpbnB1dC5vZmZzZXQsIGlucHV0LmxpbWl0LCBpbnB1dC5maWxlUGF0aCk7XG4gICAgfVxuICAgIGNvbnN0IGFkZGl0aW9uYWxDb250ZXh0ID0gYXdhaXQgY29tcHV0ZVN1cmZhY2UoaW5wdXQsIGV4ZWN1dG9ycywgbWVtbywgcmFuZ2UpO1xuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0LCB0cmVlTW9kaWZpZWQgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBuZXZlciBsZXQgYSB0b3VjaC1jb3JlIGVycm9yIHByb3BhZ2F0ZSB1cCBhbmQgYmxvY2sgdGhlIHRvb2xcbiAgICAvLyBjYWxsLiBUaGUgdHJlZSBtYXkgYWxyZWFkeSBoYXZlIGJlZW4gaGVhbGVkICh0cmVlTW9kaWZpZWQgcHJlc2VydmVkKS5cbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkIH07XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDEwXzAwMDtcblxuLyoqIFJlc29sdmUgdGhlIHRvdWNoZWQgZmlsZSB0byBhIHBhdGggcmVsYXRpdmUgdG8gaXRzIHJlcG8gcm9vdCwgZm9yIGBnaXQgc3BhbmAuICovXG5mdW5jdGlvbiByZXBvUmVsQXJnKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogeyByZXBvUm9vdDogc3RyaW5nOyByZWxQYXRoOiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlbFBhdGg6IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBmaWxlUGF0aCkgfTtcbn1cblxuLyoqXG4gKiBBIHNuYXBzaG90IG9mIHRoZSBzcGFuIHJvb3QncyB3b3JraW5nLXRyZWUgc3RhdHVzLCB1c2VkIHRvIGRldGVjdCB3aGV0aGVyIGFcbiAqIGAtLWZpeGAgcmUtYW5jaG9yZWQgYW55dGhpbmcuIENvbXBhcmVkIGJlZm9yZS9hZnRlcjsgYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3JcbiAqIGEgZmFpbGVkIHN0YXR1cyB5aWVsZHMgYSBzdGFibGUgZW1wdHkgc3RyaW5nIChcdTIxOTIgYG1vZGlmaWVkOiBmYWxzZWApLlxuICovXG5mdW5jdGlvbiBzcGFuU3RhdHVzU25hcHNob3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdzdGF0dXMnLCAnLS1wb3JjZWxhaW4nLCAnLS0nLCBzcGFuUm9vdF0sIHtcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBleGVjdXRpb24gc3VyZmFjZTogdGhyZWUgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgYGNyZWF0ZURlZmF1bHQqRXhlY3V0b3JgIHN0eWxlLiBFYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuIG9uXG4gKiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuICogbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgcGFyc2UgZmFpbHVyZSkgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0XG4gKiBzbyB7QGxpbmsgcnVuVG91Y2hIb29rfSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IFRvdWNoRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4geyBtb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsIHJlc29sdmVkLnJlbFBhdGgsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsXG4gICAgICAgIC8vIGFuZCBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgc3RhbGU6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gc3RhbGVgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VTdGFsZVBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogQ29kZXggYGFwcGx5X3BhdGNoYCBlbnZlbG9wZSBwYXJzZXIuXG4gKlxuICogVHVybnMgYSBDb2RleCBgYXBwbHlfcGF0Y2hgIGB0b29sX2lucHV0LmNvbW1hbmRgIHBhdGNoIHN0cmluZyBpbnRvIHRoZVxuICogYEFuY2hvclNwZWNbXWAgc2hhcGUgdGhlIHNoYXJlZCB0b3VjaCBjb3JlIGFscmVhZHkgY29uc3VtZXMgXHUyMDE0IHRoZSBvbmVcbiAqIGdlbnVpbmVseSBuZXcgYWxnb3JpdGhtIHRoZSBDb2RleCBhZGFwdGVyIG5lZWRzLiBJdCByZXBsYWNlcyB0aGUgc3RydWN0dXJlZFxuICogYGZpbGVfcGF0aGAvYG9sZF9zdHJpbmdgL2BvZmZzZXRgIHJlYWRpbmcgdGhlIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rXG4gKiBkb2VzLCBiZWNhdXNlIENvZGV4IGRlbGl2ZXJzIGV2ZXJ5IGVkaXQgYXMgYSBzaW5nbGUgYXBwbHlfcGF0Y2ggZW52ZWxvcGVcbiAqIHJhdGhlciB0aGFuIGEgdHlwZWQgdG9vbCBpbnB1dC5cbiAqXG4gKiBUaGUgbW9kdWxlIGlzIHB1cmU6IGl0IGltcG9ydHMgb25seSB0aGUga2VybmVsIGFuY2hvciB0eXBlcyBhbmQgbmV2ZXIgdG91Y2hlc1xuICogdGhlIENvZGV4IFNESywgc28gaXQgaXMgREktdGVzdGFibGUgZXhhY3RseSBsaWtlIHRoZSBwb3JjZWxhaW4gcGFyc2VycyBpbiB0aGVcbiAqIHNoYXJlZCBrZXJuZWwuIFJhbmdlIHJlY292ZXJ5IGlzIGJlc3QtZWZmb3J0IFx1MjAxNCB0aGUgYXBwbHlfcGF0Y2ggZm9ybWF0IGNhcnJpZXNcbiAqIGBAQGAgY29udGV4dCBhbmQgYCtgL2AtYC9zcGFjZSBjaGFuZ2UgbGluZXMgYnV0IG5vIGV4cGxpY2l0IGxpbmUgbnVtYmVycywgc28gYVxuICogcmFuZ2UgY2FuIG9ubHkgYmUgcmVjb3ZlcmVkIGJ5IGxvY2F0aW5nIGEgaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZVxuICogb24tZGlzayBmaWxlLiBUaGF0IGZpbGUgcmVhZCBpcyBpbmplY3RlZCAoYHJlYWRQcmVFZGl0RmlsZWApIHNvIHRoZSBmdW5jdGlvblxuICogc3RheXMgcHVyZSBhbmQgdGVzdGFibGUuIE9uIEFOWSBhbWJpZ3VpdHkgKG5vIHJlYWRlciwgZmlsZSBtaXNzaW5nLCBjb250ZXh0XG4gKiBub3QgZm91bmQsIGZ1enp5L2R1cGxpY2F0ZSBtYXRjaCkgdGhlIHBhcnNlciBkZWdyYWRlcyB0byBhIHdob2xlLWZpbGUgYW5jaG9yXG4gKiByYXRoZXIgdGhhbiB0aHJvd2luZyBcdTIwMTQgd2hvbGUtZmlsZSBhbmNob3JzIGFyZSBmaXJzdC1jbGFzcyBhbmQgdG91Y2ggdHJhY2tpbmdcbiAqIG11c3QgbmV2ZXIgYmUgYmxvY2tlZC5cbiAqXG4gKiBUaGUgZ3JhbW1hciBpcyBjcm9zcy1jaGVja2VkIGFnYWluc3QgQ29kZXgncyBvd24gYXBwbHlfcGF0Y2ggY3JhdGVcbiAqIChjb2RleC1ycy9hcHBseS1wYXRjaC9zcmMve3BhcnNlcixzdHJlYW1pbmdfcGFyc2VyfS5ycykuIFR3byBzdWJ0bGV0aWVzIGFyZVxuICogbWlycm9yZWQgZGVsaWJlcmF0ZWx5OiBodW5rLWhlYWRlciBtYXJrZXJzIGFyZSBvbmx5IHJlY29nbml6ZWQgYXQgdGhlIHN0YXJ0IG9mXG4gKiBhIGxpbmUgd2l0aCBubyBsZWFkaW5nIHdoaXRlc3BhY2Ugd2hpbGUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rIChhIGxlYWRpbmcgc3BhY2VcbiAqIGRlbW90ZXMgYSBtYXJrZXIgdG8gYSBjb250ZXh0IGxpbmUpLCBhbmQgYSBiYXJlIGVtcHR5IGxpbmUgaW5zaWRlIGFuIFVwZGF0ZVxuICogaHVuayBpcyB0cmVhdGVkIGFzIGFuIGVtcHR5IGNvbnRleHQgbGluZSBwcmVzZW50IGluIGJvdGggb2xkIGFuZCBuZXcgY29udGVudC5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB0eXBlIHsgQW5jaG9yU3BlYywgTGluZVJhbmdlIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5cbi8qKlxuICogUmVhZHMgdGhlIHByZS1lZGl0IChvbi1kaXNrLCBiZWZvcmUgdGhlIHBhdGNoIGFwcGxpZXMpIGNvbnRlbnQgb2YgdGhlIGZpbGUgYXRcbiAqIGBwYXRoYCwgb3IgcmV0dXJucyBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgcmVhZC4gSW5qZWN0ZWQgc28gdGhlIHBhcnNlciBzdGF5c1xuICogcHVyZTsgY2FsbCBzaXRlcyBkZWZhdWx0IHRvIGEgcmVhbCBmaWxlc3lzdGVtIHJlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIFJlYWRQcmVFZGl0RmlsZSA9IChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyB8IG51bGw7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR3JhbW1hciBtYXJrZXJzIChtaXJyb3JzIGNvZGV4LXJzL2FwcGx5LXBhdGNoL3NyYy9wYXJzZXIucnMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgRU5EX1BBVENIX01BUktFUiA9ICcqKiogRW5kIFBhdGNoJztcbmNvbnN0IEFERF9GSUxFX01BUktFUiA9ICcqKiogQWRkIEZpbGU6ICc7XG5jb25zdCBERUxFVEVfRklMRV9NQVJLRVIgPSAnKioqIERlbGV0ZSBGaWxlOiAnO1xuY29uc3QgVVBEQVRFX0ZJTEVfTUFSS0VSID0gJyoqKiBVcGRhdGUgRmlsZTogJztcbmNvbnN0IE1PVkVfVE9fTUFSS0VSID0gJyoqKiBNb3ZlIHRvOiAnO1xuY29uc3QgRU9GX01BUktFUiA9ICcqKiogRW5kIG9mIEZpbGUnO1xuY29uc3QgQ0hBTkdFX0NPTlRFWFRfTUFSS0VSID0gJ0BAICc7XG5jb25zdCBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIgPSAnQEAnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEludGVybWVkaWF0ZSBodW5rIG1vZGVsXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFVwZGF0ZUNodW5rIHtcbiAgLyoqIE9wdGlvbmFsIGBAQCA8Y29udGV4dD5gIGxpbmUgdXNlZCB0byBkaXNhbWJpZ3VhdGUgdGhlIGJsb2NrJ3MgbG9jYXRpb24uICovXG4gIGNoYW5nZUNvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBQcmUtZWRpdCBsaW5lcyB0aGlzIGNodW5rIGNvdmVycyAoY29udGV4dCBgIGAgKyByZW1vdmVkIGAtYCksIGluIG9yZGVyLiAqL1xuICBvbGRMaW5lczogc3RyaW5nW107XG4gIC8qKiBQb3N0LWVkaXQgbGluZXMgKGNvbnRleHQgYCBgICsgYWRkZWQgYCtgKTsgcmV0YWluZWQgZm9yIGNvbXBsZXRlbmVzcy4gKi9cbiAgbmV3TGluZXM6IHN0cmluZ1tdO1xufVxuXG50eXBlIEh1bmsgPVxuICB8IHsga2luZDogJ2FkZCc7IHBhdGg6IHN0cmluZyB9XG4gIHwgeyBraW5kOiAnZGVsZXRlJzsgcGF0aDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6ICd1cGRhdGUnOyBwYXRoOiBzdHJpbmc7IG1vdmVQYXRoOiBzdHJpbmcgfCBudWxsOyBjaHVua3M6IFVwZGF0ZUNodW5rW10gfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHJlYWRlclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVhbC1maWxlc3lzdGVtIHJlYWRlciB1c2VkIHdoZW4gbm8gcmVhZGVyIGlzIGluamVjdGVkLiBCZXN0LWVmZm9ydDogYW55XG4gKiBmYWlsdXJlIChtaXNzaW5nIGZpbGUsIHBlcm1pc3Npb24gZXJyb3IpIHlpZWxkcyBgbnVsbGAsIHdoaWNoIHRoZSBwYXJzZXJcbiAqIGRlZ3JhZGVzIHRvIGEgd2hvbGUtZmlsZSBhbmNob3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UmVhZFByZUVkaXRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5yZWFkRmlsZVN5bmMocGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRW52ZWxvcGUgc2Nhbm5pbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFNjYW4gdGhlIHBhdGNoIHRleHQgaW50byBodW5rcy4gTGVuaWVudCBieSBkZXNpZ246IHVucmVjb2duaXplZCBsaW5lcyBhcmVcbiAqIGlnbm9yZWQgcmF0aGVyIHRoYW4gcmVqZWN0ZWQsIGFuZCBCZWdpbi9FbmQvRW52aXJvbm1lbnQgbGluZXMgYXJlIHNraXBwZWQsIHNvXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSBkZWdyYWRlcyB0byB3aGF0ZXZlciBodW5rcyBjb3VsZCBiZSByZWNvdmVyZWQgKG9mdGVuXG4gKiBub25lIFx1MjE5MiBgW11gKSBpbnN0ZWFkIG9mIHRocm93aW5nLlxuICovXG5mdW5jdGlvbiBzY2FuSHVua3MoY29tbWFuZDogc3RyaW5nKTogSHVua1tdIHtcbiAgY29uc3QgaHVua3M6IEh1bmtbXSA9IFtdO1xuICAvLyBUaGUgY3VycmVudGx5LW9wZW4gVXBkYXRlIGh1bmssIG9yIG51bGwuIEFkZC9EZWxldGUgaHVua3MgaGF2ZSBubyBib2R5LCBzb1xuICAvLyB0aGV5IGNsb3NlIGltbWVkaWF0ZWx5IGFuZCByZXNldCB0aGlzIHRvIG51bGwuXG4gIGxldCBvcGVuVXBkYXRlOiAoSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSkgfCBudWxsID0gbnVsbDtcblxuICBmb3IgKGNvbnN0IHJhdyBvZiBjb21tYW5kLnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEhlYWRlciBkZXRlY3Rpb24gaXMgd2hpdGVzcGFjZS1zZW5zaXRpdmUgaW5zaWRlIGFuIFVwZGF0ZSBodW5rOiBDb2RleCB1c2VzXG4gICAgLy8gdHJpbV9lbmQgdGhlcmUgKGxlYWRpbmcgc3BhY2UgZGVtb3RlcyBhIG1hcmtlciB0byBhIGNvbnRleHQgbGluZSkgYW5kIGZ1bGxcbiAgICAvLyB0cmltIGVsc2V3aGVyZS4gTWF0Y2ggdGhhdCBzbyBpbmRlbnRlZCBtYXJrZXJzIGluc2lkZSBhIGh1bmsgc3RheSBjb250ZW50LlxuICAgIGNvbnN0IGhlYWRlckxpbmU6IHN0cmluZyA9IG9wZW5VcGRhdGUgPyByYXcucmVwbGFjZSgvWyBcXHRcXHJdKyQvLCAnJykgOiByYXcudHJpbSgpO1xuXG4gICAgaWYgKGhlYWRlckxpbmUgPT09IEVORF9QQVRDSF9NQVJLRVIpIHtcbiAgICAgIG9wZW5VcGRhdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChoZWFkZXJMaW5lLnN0YXJ0c1dpdGgoQUREX0ZJTEVfTUFSS0VSKSkge1xuICAgICAgaHVua3MucHVzaCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKEFERF9GSUxFX01BUktFUi5sZW5ndGgpIH0pO1xuICAgICAgb3BlblVwZGF0ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGhlYWRlckxpbmUuc3RhcnRzV2l0aChERUxFVEVfRklMRV9NQVJLRVIpKSB7XG4gICAgICBodW5rcy5wdXNoKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IGhlYWRlckxpbmUuc2xpY2UoREVMRVRFX0ZJTEVfTUFSS0VSLmxlbmd0aCkgfSk7XG4gICAgICBvcGVuVXBkYXRlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaGVhZGVyTGluZS5zdGFydHNXaXRoKFVQREFURV9GSUxFX01BUktFUikpIHtcbiAgICAgIGNvbnN0IGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0gPSB7XG4gICAgICAgIGtpbmQ6ICd1cGRhdGUnLFxuICAgICAgICBwYXRoOiBoZWFkZXJMaW5lLnNsaWNlKFVQREFURV9GSUxFX01BUktFUi5sZW5ndGgpLFxuICAgICAgICBtb3ZlUGF0aDogbnVsbCxcbiAgICAgICAgY2h1bmtzOiBbXVxuICAgICAgfTtcbiAgICAgIGh1bmtzLnB1c2goaHVuayk7XG4gICAgICBvcGVuVXBkYXRlID0gaHVuaztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChvcGVuVXBkYXRlKSB7XG4gICAgICBwcm9jZXNzVXBkYXRlTGluZShvcGVuVXBkYXRlLCByYXcpO1xuICAgIH1cbiAgICAvLyBBbnkgb3RoZXIgbGluZSBvdXRzaWRlIGFuIFVwZGF0ZSBodW5rIChCZWdpbiBQYXRjaCwgRW52aXJvbm1lbnQgSUQsIEFkZFxuICAgIC8vIEZpbGUgYCtgIGNvbnRlbnQsIHN0cmF5IHRleHQpIGlzIGlnbm9yZWQuXG4gIH1cblxuICByZXR1cm4gaHVua3M7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZUNodW5rKGh1bms6IEh1bmsgJiB7IGtpbmQ6ICd1cGRhdGUnIH0pOiBVcGRhdGVDaHVuayB7XG4gIGNvbnN0IGxhc3QgPSBodW5rLmNodW5rc1todW5rLmNodW5rcy5sZW5ndGggLSAxXTtcbiAgaWYgKGxhc3QpIHJldHVybiBsYXN0O1xuICBjb25zdCBjaHVuazogVXBkYXRlQ2h1bmsgPSB7IGNoYW5nZUNvbnRleHQ6IG51bGwsIG9sZExpbmVzOiBbXSwgbmV3TGluZXM6IFtdIH07XG4gIGh1bmsuY2h1bmtzLnB1c2goY2h1bmspO1xuICByZXR1cm4gY2h1bms7XG59XG5cbi8qKiBBcHBseSBvbmUgYm9keSBsaW5lIG9mIGFuIFVwZGF0ZSBodW5rIHRvIGl0cyBjaHVuayBsaXN0LiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1VwZGF0ZUxpbmUoaHVuazogSHVuayAmIHsga2luZDogJ3VwZGF0ZScgfSwgcmF3OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdHJpbW1lZEVuZCA9IHJhdy5yZXBsYWNlKC9bIFxcdFxccl0rJC8sICcnKTtcblxuICBpZiAodHJpbW1lZEVuZCA9PT0gRU9GX01BUktFUikgcmV0dXJuOyAvLyBlbmQtb2YtZmlsZSBoaW50OyBub3QgbmVlZGVkIGZvciByYW5nZXNcblxuICAvLyBgKioqIE1vdmUgdG86YCBpcyBvbmx5IG1lYW5pbmdmdWwgYmVmb3JlIGFueSBjaGFuZ2UgY29udGVudC5cbiAgaWYgKGh1bmsuY2h1bmtzLmxlbmd0aCA9PT0gMCAmJiBodW5rLm1vdmVQYXRoID09PSBudWxsICYmIHRyaW1tZWRFbmQuc3RhcnRzV2l0aChNT1ZFX1RPX01BUktFUikpIHtcbiAgICBodW5rLm1vdmVQYXRoID0gdHJpbW1lZEVuZC5zbGljZShNT1ZFX1RPX01BUktFUi5sZW5ndGgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICh0cmltbWVkRW5kID09PSBFTVBUWV9DSEFOR0VfQ09OVEVYVF9NQVJLRVIpIHtcbiAgICBodW5rLmNodW5rcy5wdXNoKHsgY2hhbmdlQ29udGV4dDogbnVsbCwgb2xkTGluZXM6IFtdLCBuZXdMaW5lczogW10gfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0cmltbWVkRW5kLnN0YXJ0c1dpdGgoQ0hBTkdFX0NPTlRFWFRfTUFSS0VSKSkge1xuICAgIGh1bmsuY2h1bmtzLnB1c2goeyBjaGFuZ2VDb250ZXh0OiB0cmltbWVkRW5kLnNsaWNlKENIQU5HRV9DT05URVhUX01BUktFUi5sZW5ndGgpLCBvbGRMaW5lczogW10sIG5ld0xpbmVzOiBbXSB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBBIGJhcmUgZW1wdHkgbGluZSBpcyBhbiBlbXB0eSBjb250ZXh0IGxpbmUgKHByZXNlbnQgaW4gYm90aCBvbGQgYW5kIG5ldykuXG4gIGlmIChyYXcgPT09ICcnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjaHVuay5vbGRMaW5lcy5wdXNoKCcnKTtcbiAgICBjaHVuay5uZXdMaW5lcy5wdXNoKCcnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgZmlyc3QgPSByYXdbMF07XG4gIGlmIChmaXJzdCA9PT0gJyAnKSB7XG4gICAgY29uc3QgY2h1bmsgPSBlbnN1cmVDaHVuayhodW5rKTtcbiAgICBjb25zdCBjb250ZW50ID0gcmF3LnNsaWNlKDEpO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2goY29udGVudCk7XG4gICAgY2h1bmsubmV3TGluZXMucHVzaChjb250ZW50KTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnKycpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm5ld0xpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGZpcnN0ID09PSAnLScpIHtcbiAgICBjb25zdCBjaHVuayA9IGVuc3VyZUNodW5rKGh1bmspO1xuICAgIGNodW5rLm9sZExpbmVzLnB1c2gocmF3LnNsaWNlKDEpKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gVW5yZWNvZ25pemVkIGNvbnRlbnQgbGluZSBcdTIwMTQgaWdub3JlIGxlbmllbnRseSByYXRoZXIgdGhhbiB0aHJvdy5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTcGxpdCBmaWxlIGNvbnRlbnQgaW50byBsaW5lcyBmb3IgbWF0Y2hpbmcuIEEgdHJhaWxpbmcgbmV3bGluZSB5aWVsZHMgYVxuICogdHJhaWxpbmcgZW1wdHkgZWxlbWVudCwgd2hpY2ggaXMgaGFybWxlc3MgZm9yIHN1Yi1zbGljZSBtYXRjaGluZy4gKi9cbmZ1bmN0aW9uIHNwbGl0TGluZXMoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gY29udGVudC5zcGxpdCgnXFxuJyk7XG59XG5cbi8qKiBJbmRpY2VzICgwLWJhc2VkKSBhdCB3aGljaCBgdmFsdWVgIGFwcGVhcnMgYXMgYSBmdWxsIGxpbmUgaW4gYGxpbmVzYC4gKi9cbmZ1bmN0aW9uIGxpbmVJbmRpY2VzKGxpbmVzOiBzdHJpbmdbXSwgdmFsdWU6IHN0cmluZyk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGxpbmVzW2ldID09PSB2YWx1ZSkgb3V0LnB1c2goaSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFN0YXJ0IGluZGljZXMgKDAtYmFzZWQpIGF0IHdoaWNoIGBuZWVkbGVgIG1hdGNoZXMgY29udGlndW91c2x5IGluIGBoYXlzdGFja2AuICovXG5mdW5jdGlvbiBjb250aWd1b3VzTWF0Y2hlcyhoYXlzdGFjazogc3RyaW5nW10sIG5lZWRsZTogc3RyaW5nW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgaWYgKG5lZWRsZS5sZW5ndGggPT09IDAgfHwgbmVlZGxlLmxlbmd0aCA+IGhheXN0YWNrLmxlbmd0aCkgcmV0dXJuIG91dDtcbiAgY29uc3QgbGFzdCA9IGhheXN0YWNrLmxlbmd0aCAtIG5lZWRsZS5sZW5ndGg7XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSBvdXQucHVzaChpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIExvY2F0ZSBhIHNpbmdsZSBjaHVuaydzIHByZS1lZGl0IGJsb2NrIGluIHRoZSBmaWxlLCByZXR1cm5pbmcgaXRzIDEtYmFzZWRcbiAqIGxpbmUgcmFuZ2Ugb3IgbnVsbCB3aGVuIGl0IGNhbm5vdCBiZSBsb2NhdGVkIHVuYW1iaWd1b3VzbHkuXG4gKlxuICogLSBOb24tZW1wdHkgYmxvY2s6IHJlcXVpcmUgYSB1bmlxdWUgY29udGlndW91cyBtYXRjaCwgb3IgXHUyMDE0IHdoZW4gZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgYSBgQEBgIGNoYW5nZS1jb250ZXh0IGxpbmUgdGhhdCBzZWxlY3RzIHRoZSBvY2N1cnJlbmNlIGFmdGVyIGl0LlxuICogLSBFbXB0eSBibG9jayAocHVyZSBpbnNlcnRpb24pOiBhbmNob3Igb24gYSB1bmlxdWUgY2hhbmdlLWNvbnRleHQgbGluZSBpZiBvbmVcbiAqICAgaXMgZ2l2ZW47IG90aGVyd2lzZSBpdCBpcyB1bmxvY2F0YWJsZS5cbiAqL1xuZnVuY3Rpb24gbG9jYXRlQ2h1bmsocHJlTGluZXM6IHN0cmluZ1tdLCBjaHVuazogVXBkYXRlQ2h1bmspOiBMaW5lUmFuZ2UgfCBudWxsIHtcbiAgY29uc3QgYmxvY2sgPSBjaHVuay5vbGRMaW5lcztcblxuICBpZiAoYmxvY2subGVuZ3RoID09PSAwKSB7XG4gICAgY29uc3QgY3R4ID0gY2h1bmsuY2hhbmdlQ29udGV4dDtcbiAgICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICAgIGNvbnN0IGN0eElkeHMgPSBsaW5lSW5kaWNlcyhwcmVMaW5lcywgY3R4KTtcbiAgICAgIGlmIChjdHhJZHhzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBjb25zdCBsaW5lID0gY3R4SWR4c1swXSArIDE7XG4gICAgICAgIHJldHVybiB7IHN0YXJ0OiBsaW5lLCBlbmQ6IGxpbmUgfTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBzdGFydHMgPSBjb250aWd1b3VzTWF0Y2hlcyhwcmVMaW5lcywgYmxvY2spO1xuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IHMgPSBzdGFydHNbMF07XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHMgKyAxLCBlbmQ6IHMgKyBibG9jay5sZW5ndGggfTtcbiAgfVxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRHVwbGljYXRlZCBibG9jazogdXNlIHRoZSBjaGFuZ2UgY29udGV4dCB0byBzZWxlY3QgdGhlIG1hdGNoIGFmdGVyIGl0LlxuICBjb25zdCBjdHggPSBjaHVuay5jaGFuZ2VDb250ZXh0O1xuICBpZiAoY3R4ICE9PSBudWxsICYmIGN0eCAhPT0gJycpIHtcbiAgICBmb3IgKGNvbnN0IGMgb2YgbGluZUluZGljZXMocHJlTGluZXMsIGN0eCkpIHtcbiAgICAgIGNvbnN0IGFmdGVyID0gc3RhcnRzLmZpbmQoKHMpID0+IHMgPj0gYyk7XG4gICAgICBpZiAoYWZ0ZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4geyBzdGFydDogYWZ0ZXIgKyAxLCBlbmQ6IGFmdGVyICsgYmxvY2subGVuZ3RoIH07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsOyAvLyBhbWJpZ3VvdXMgXHUyMTkyIGNhbGxlciBkZWdyYWRlcyB0byB3aG9sZS1maWxlXG59XG5cbi8qKlxuICogUmVjb3ZlciBhIHNpbmdsZSBsaW5lIHJhbmdlIHNwYW5uaW5nIGFsbCBvZiBhbiB1cGRhdGUncyBjaHVua3MuIFJldHVybnMgbnVsbFxuICogKFx1MjE5MiB3aG9sZS1maWxlIGZhbGxiYWNrKSBpZiBhbnkgY2h1bmsgY2Fubm90IGJlIGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSYW5nZShwcmVMaW5lczogc3RyaW5nW10sIGNodW5rczogVXBkYXRlQ2h1bmtbXSk6IExpbmVSYW5nZSB8IG51bGwge1xuICBsZXQgdW5pb246IExpbmVSYW5nZSB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgIGNvbnN0IHIgPSBsb2NhdGVDaHVuayhwcmVMaW5lcywgY2h1bmspO1xuICAgIGlmIChyID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICB1bmlvbiA9IHVuaW9uID09PSBudWxsID8gciA6IHsgc3RhcnQ6IE1hdGgubWluKHVuaW9uLnN0YXJ0LCByLnN0YXJ0KSwgZW5kOiBNYXRoLm1heCh1bmlvbi5lbmQsIHIuZW5kKSB9O1xuICB9XG4gIHJldHVybiB1bmlvbjtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgQVBJXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBQYXJzZSBhIENvZGV4IGBhcHBseV9wYXRjaGAgY29tbWFuZCBzdHJpbmcgaW50byBhbiBhbmNob3IgcGVyIHRvdWNoZWQgZmlsZS5cbiAqXG4gKiAtIGAqKiogQWRkIEZpbGU6YCBcdTIxOTIgYGNyZWF0ZWAgKHdob2xlLWZpbGUpXG4gKiAtIGAqKiogRGVsZXRlIEZpbGU6YCBcdTIxOTIgYHdob2xlLXdyaXRlYCAod2hvbGUtZmlsZTsgdGhlIGZpbGUgbm8gbG9uZ2VyIGV4aXN0cylcbiAqIC0gYCoqKiBVcGRhdGUgRmlsZTpgIFx1MjE5MiBgd3JpdGVgIHdpdGggYSByZWNvdmVyZWQgbGluZSByYW5nZSB3aGVuIHRoZSBodW5rJ3NcbiAqICAgcHJlLWVkaXQgYmxvY2sgY2FuIGJlIGxvY2F0ZWQgdmlhIGByZWFkUHJlRWRpdEZpbGVgLCBvdGhlcndpc2UgYHdob2xlLXdyaXRlYC5cbiAqICAgQSByZW5hbWVkIHVwZGF0ZSAoYCoqKiBNb3ZlIHRvOmApIGFuY2hvcnMgdGhlIGRlc3RpbmF0aW9uIHBhdGggYXNcbiAqICAgYHdob2xlLXdyaXRlYCBzaW5jZSBwcmUtZWRpdCBsaW5lIG51bWJlcnMgY2Fubm90IGJlIG1hcHBlZCBhY3Jvc3MgYSByZW5hbWUuXG4gKlxuICogTmV2ZXIgdGhyb3dzOiBhIG1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB5aWVsZHMgYFtdYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQXBwbHlQYXRjaChcbiAgY29tbWFuZDogc3RyaW5nLFxuICByZWFkUHJlRWRpdEZpbGU6IFJlYWRQcmVFZGl0RmlsZSA9IGRlZmF1bHRSZWFkUHJlRWRpdEZpbGVcbik6IEFuY2hvclNwZWNbXSB7XG4gIGNvbnN0IGFuY2hvcnM6IEFuY2hvclNwZWNbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgaHVuayBvZiBzY2FuSHVua3MoY29tbWFuZCkpIHtcbiAgICBpZiAoaHVuay5raW5kID09PSAnYWRkJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnY3JlYXRlJyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaHVuay5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgYW5jaG9ycy5wdXNoKHsgcGF0aDogdG9Qb3NpeChodW5rLnBhdGgpLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlOiBhbmNob3Igb24gdGhlIGRlc3RpbmF0aW9uIHBhdGggKHBvc3QtZWRpdCBsb2NhdGlvbikuXG4gICAgY29uc3QgdGFyZ2V0UGF0aCA9IHRvUG9zaXgoaHVuay5tb3ZlUGF0aCA/PyBodW5rLnBhdGgpO1xuXG4gICAgLy8gQSByZW5hbWUgZGVmZWF0cyBwcmUtZWRpdCBsaW5lIG1hcHBpbmcgXHUyMDE0IGFuY2hvciB3aG9sZS1maWxlIG9uIHRoZSB0YXJnZXQuXG4gICAgaWYgKGh1bmsubW92ZVBhdGggIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3aG9sZS13cml0ZScgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBSYW5nZSByZWNvdmVyeSByZWFkcyB0aGUgcHJlLWVkaXQgY29udGVudCBhdCB0aGUgb3JpZ2luYWwgKHByZS1tb3ZlKSBwYXRoLlxuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkUHJlRWRpdEZpbGUoaHVuay5wYXRoKTtcbiAgICBjb25zdCByYW5nZSA9IGNvbnRlbnQgPT09IG51bGwgPyBudWxsIDogcmVjb3ZlclJhbmdlKHNwbGl0TGluZXMoY29udGVudCksIGh1bmsuY2h1bmtzKTtcbiAgICBpZiAocmFuZ2UgIT09IG51bGwpIHtcbiAgICAgIGFuY2hvcnMucHVzaCh7IHBhdGg6IHRhcmdldFBhdGgsIGtpbmQ6ICd3cml0ZScsIHJhbmdlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBhbmNob3JzLnB1c2goeyBwYXRoOiB0YXJnZXRQYXRoLCBraW5kOiAnd2hvbGUtd3JpdGUnIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhbmNob3JzO1xufVxuIiwgIi8qKlxuICogQ29kZXggUG9zdFRvb2xVc2UgdG91Y2ggaG9vayBcdTIwMTQgaGVhbCArIHN1cmZhY2UgYWZ0ZXIgYSBjb25maXJtZWQgYGFwcGx5X3BhdGNoYC5cbiAqXG4gKiBQb3N0VG9vbFVzZSBmaXJlcyBhZnRlciBgYXBwbHlfcGF0Y2hgIGhhcyBydW4sIHNvIHRoaXMgaXMgdGhlIGFjY3VyYXRlIGhvbWUgZm9yXG4gKiB0aGUgdG91Y2ggc2lnbmFsOiB0aGUgZmlsZSBpcyBhbHJlYWR5IHdyaXR0ZW4sIHNvIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZVxuICogPGZpbGU+IC0tZml4YCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGFnYWluc3QgcmVhbCBieXRlcyBhbmQgdGhlIHN1cmZhY2VkIGJsb2NrXG4gKiByZWZsZWN0cyB0aGUgaGVhbGVkIGFuY2hvcnMuIFRoZSBoYW5kbGVyIG5hcnJvd3MgdGhlIGBhcHBseV9wYXRjaGAgZW52ZWxvcGVcbiAqIChgdG9vbF9pbnB1dC5jb21tYW5kYCwgU0RLLXR5cGVkIGB1bmtub3duYCkgaW50byBwZXItZmlsZSBhbmNob3JzIHZpYSB0aGVcbiAqIHNoYXJlZCBbYXBwbHktcGF0Y2ggcGFyc2VyXSguL2FwcGx5LXBhdGNoLnRzKSwgc2NvcGVzIGVhY2ggdG91Y2hlZCBmaWxlIHRvIHRoZVxuICogQ1dEIHJlcG8sIGFuZCBkcml2ZXMgdGhlIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZSBcdTIwMTQgdGhlIHNhbWVcbiAqIGNvcmUgdGhlIENsYXVkZSBhZGFwdGVyIHVzZXMuXG4gKlxuICogVHdvIENvZGV4LXNwZWNpZmljIGNvbmNlcm5zIGFyZSBwcmVzZXJ2ZWQgZnJvbSB0aGlzIGZpbGUncyBqb3VybmFsaW5nXG4gKiBwcmVkZWNlc3NvcjpcbiAqXG4gKiAxLiAqKlN1Y2Nlc3MgY2xhc3NpZmljYXRpb24uKiogVGhlIHBhcnNlZCBlbnZlbG9wZSBkZXNjcmliZXMgKmludGVudCosIG5vdFxuICogICAgKm91dGNvbWUqLiBDb2RleCBjb3JlIGZpcmVzIFBvc3RUb29sVXNlIG9ubHkgb24gdG9vbCBzdWNjZXNzLCBidXQgYXMgYVxuICogICAgZHVyYWJpbGl0eSBiZWx0IHdlIGNsYXNzaWZ5IGB0b29sX3Jlc3BvbnNlYCB2aWFcbiAqICAgIHtAbGluayBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZX06IGEgY29uZmlybWVkIHJlamVjdGlvbiAoYCdmYWlsdXJlJ2ApXG4gKiAgICBzdXBwcmVzc2VzIHRoZSB0b3VjaCAobm8gcGhhbnRvbSBoZWFsL3N1cmZhY2Ugb24gYSBwYXRjaCB0aGF0IG5ldmVyXG4gKiAgICBhcHBsaWVkKTsgYSBzdWNjZXNzIG9yIGFuIHVucmVjb2duaXplZCBzaGFwZSAoYCd1bmtub3duJ2AsIHdhcm5lZCkgcHJvY2VlZHMuXG4gKiAyLiAqKk5vIHBvc3QtZWRpdCByYW5nZSByZWNvdmVyeSBmcm9tIHRoZSBlbnZlbG9wZS4qKiBQb3N0VG9vbFVzZSBydW5zIGFmdGVyXG4gKiAgICB0aGUgcGF0Y2ggcmV3cm90ZSB0aGUgZmlsZSwgc28gdGhlIGh1bmsncyBwcmUtZWRpdCBibG9jayBubyBsb25nZXIgc2l0c1xuICogICAgd2hlcmUgdGhlIGVkaXQgaGFwcGVuZWQgYW5kIGNvdWxkIG1pcy1hbmNob3IgYSBkdXBsaWNhdGUuIFRoZSB0b3VjaCBpc1xuICogICAgc2NvcGVkIGZpbGUtd2lkZSAoYHdyaXR0ZW46ICcnYCBcdTIxOTIgd2hvbGUtZmlsZSksIHdoaWNoIGlzIGV4YWN0bHkgdGhlXG4gKiAgICBiZWhhdmlvciB7QGxpbmsgcnVuVG91Y2hIb29rfSB0YWtlcyBmb3IgYW4gZW1wdHkgd3JpdGUuXG4gKlxuICogVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGluIHRoZSBoYW5kbGVyIGNvbmZpZyAodGhlIENMSSBlbWl0cyBgMTBgIHNlY29uZHMpXG4gKiBcdTIwMTQgc2VlIHRoZSB0aW1lb3V0LXVuaXRzIHNwaWtlIG5vdGU7IHRoZSBzb3VyY2UgdmFsdWUgbXVzdCBzdGF5IGluIG1zIHNvIHRoZVxuICogQ29kZXggYnVpbGQncyBzZWNvbmRzIGNvbnZlcnNpb24gYXQgZW1pdCByZW1haW5zIGNvcnJlY3QuXG4gKi9cblxuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQb3N0VG9vbFVzZUlucHV0LCBwb3N0VG9vbFVzZUhvb2ssIHBvc3RUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7IGFic3BhdGhBZ2FpbnN0IH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLCBydW5Ub3VjaEhvb2ssIHR5cGUgVG91Y2hFeGVjdXRvcnMgfSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5pbXBvcnQgeyBwYXJzZUFwcGx5UGF0Y2ggfSBmcm9tICcuL2FwcGx5LXBhdGNoLmpzJztcblxuLyoqXG4gKiBUaGUgcHJlZml4IGFwcGx5X3BhdGNoJ3Mgc3Rkb3V0IGNhcnJpZXMgd2hlbiBcdTIwMTQgYW5kIG9ubHkgd2hlbiBcdTIwMTQgdGhlIHBhdGNoXG4gKiBhcHBsaWVkIChjb2RleC1ycy9hcHBseS1wYXRjaCBgcHJpbnRfc3VtbWFyeWApLiBDb2RleCBzdXJmYWNlcyB0aGF0IHN0ZG91dFxuICogdmVyYmF0aW0gYXMgdGhlIFBvc3RUb29sVXNlIGB0b29sX3Jlc3BvbnNlYCAoYSBiYXJlIHN0cmluZyB0b2RheSkuIEZpeGVkXG4gKiBhY3Jvc3MgQWRkL01vZGlmeS9EZWxldGU7IHRoZSBoZWFkZXIgaXMgZm9sbG93ZWQgYnkgYEEvTS9EIDxwYXRoPmAgbGluZXMuXG4gKi9cbmNvbnN0IEFQUExZX1BBVENIX1NVQ0NFU1NfUFJFRklYID0gJ1N1Y2Nlc3MuIFVwZGF0ZWQgdGhlIGZvbGxvd2luZyBmaWxlczonO1xuXG4vKipcbiAqIFRoZSBjb21tb24gZmllbGRzIGFuIG9iamVjdC13cmFwcGVkIHRvb2xfcmVzcG9uc2UgbWlnaHQgY2FycnkgdGhlIHRvb2wncyB0ZXh0XG4gKiBvdXRwdXQgdW5kZXIsIGlmIENvZGV4IGV2ZXIgc3RvcHMgc3VyZmFjaW5nIGl0IGFzIGEgYmFyZSBzdHJpbmcuIE9yZGVyZWQgYnlcbiAqIGxpa2VsaWhvb2Q7IHRoZSBmaXJzdCBmaWVsZCB3aG9zZSB2YWx1ZSBpcyBhIHN0cmluZyB3aW5zLlxuICovXG5jb25zdCBSRVNQT05TRV9URVhUX0ZJRUxEUyA9IFsnb3V0cHV0JywgJ3N0ZG91dCcsICdjb250ZW50JywgJ3RleHQnXSBhcyBjb25zdDtcblxuLyoqIE5hcnJvdyB0aGUgU0RLJ3MgYHVua25vd25gIHRvb2xfaW5wdXQgdG8gdGhlIGBhcHBseV9wYXRjaGAgYHsgY29tbWFuZCB9YCBzaGFwZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuYXJyb3dBcHBseVBhdGNoQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbElucHV0ID09PSAnb2JqZWN0JyAmJiAnY29tbWFuZCcgaW4gdG9vbElucHV0KSB7XG4gICAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gICAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVG9sZXJhbnRseSBwdWxsIHRoZSB0b29sJ3MgdGV4dHVhbCBvdXRwdXQgb3V0IG9mIGEgYHRvb2xfcmVzcG9uc2VgIG9mXG4gKiB1bmNlcnRhaW4gc2hhcGUgKFNESy10eXBlZCBgdW5rbm93bmApOiBhIGJhcmUgc3RyaW5nICh0b2RheSdzIENvZGV4KSBpc1xuICogcmV0dXJuZWQgYXMtaXM7IGFuIG9iamVjdCBpcyBwcm9iZWQgZm9yIHRoZSBmaXJzdCB7QGxpbmsgUkVTUE9OU0VfVEVYVF9GSUVMRFN9XG4gKiBlbnRyeSB0aGF0IGhvbGRzIGEgc3RyaW5nLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIHRleHQgY2FuIGJlIHJlY292ZXJlZFxuICogKHVua25vd24gb2JqZWN0IHNoYXBlLCBgbnVsbGAsIG9yIGEgbm9uLXN0cmluZy9ub24tb2JqZWN0KSwgd2hpY2ggdGhlIGNhbGxlclxuICogdHJlYXRzIGFzIGFuICp1bnJlY29nbml6ZWQqIFx1MjAxNCBub3QgKmZhaWxlZCogXHUyMDE0IHJlc3BvbnNlLlxuICovXG5mdW5jdGlvbiBleHRyYWN0UmVzcG9uc2VUZXh0KHRvb2xSZXNwb25zZTogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ3N0cmluZycpIHJldHVybiB0b29sUmVzcG9uc2U7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCByZWNvcmQgPSB0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBSRVNQT05TRV9URVhUX0ZJRUxEUykge1xuICAgICAgY29uc3QgdmFsdWUgPSByZWNvcmRbZmllbGRdO1xuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogQ2xhc3NpZnkgYW4gYGFwcGx5X3BhdGNoYCBgdG9vbF9yZXNwb25zZWAgZm9yIHRoZSB0b3VjaCBnYXRlOlxuICpcbiAqIC0gYCdzdWNjZXNzJ2AgXHUyMDE0IHRleHQgd2FzIHJlY292ZXJlZCBhbmQgY2FycmllcyB7QGxpbmsgQVBQTFlfUEFUQ0hfU1VDQ0VTU19QUkVGSVh9LlxuICogLSBgJ2ZhaWx1cmUnYCBcdTIwMTQgdGV4dCB3YXMgcmVjb3ZlcmVkIGJ1dCBsYWNrcyB0aGUgaGVhZGVyOiBhIGdlbnVpbmUgcmVqZWN0aW9uXG4gKiAgIG9yIGVycm9yLiBUaGUgT05MWSBjbGFzc2lmaWNhdGlvbiB0aGF0IHN1cHByZXNzZXMgdGhlIHRvdWNoLlxuICogLSBgJ3Vua25vd24nYCBcdTIwMTQgbm8gdGV4dCBjb3VsZCBiZSByZWNvdmVyZWQgKHVucmVjb2duaXplZCBzaGFwZSkuIFdlIHByb2NlZWRcbiAqICAgZGVmZW5zaXZlbHkgaGVyZSByYXRoZXIgdGhhbiByaXNrIG1pc3NpbmcgYSByZWFsIGVkaXQncyBoZWFsL3N1cmZhY2U7IENvZGV4XG4gKiAgIGNvcmUgZmlyZXMgUG9zdFRvb2xVc2Ugb25seSBvbiBzdWNjZXNzLCBzbyB0aGlzIGNhbm5vdCBoZWFsL3N1cmZhY2UgYSBwYXRjaFxuICogICB0aGF0IG5ldmVyIGFwcGxpZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGFzc2lmeUFwcGx5UGF0Y2hSZXNwb25zZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiAnc3VjY2VzcycgfCAnZmFpbHVyZScgfCAndW5rbm93bicge1xuICBjb25zdCB0ZXh0ID0gZXh0cmFjdFJlc3BvbnNlVGV4dCh0b29sUmVzcG9uc2UpO1xuICBpZiAodGV4dCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgcmV0dXJuIHRleHQuc3RhcnRzV2l0aChBUFBMWV9QQVRDSF9TVUNDRVNTX1BSRUZJWCkgPyAnc3VjY2VzcycgOiAnZmFpbHVyZSc7XG59XG5cbi8qKiBBIHJlYWRlciB0aGF0IGFsd2F5cyBkZWNsaW5lcywgZm9yY2luZyB0aGUgcGFyc2VyIHRvIHdob2xlLWZpbGUgYW5jaG9ycy4gKi9cbmNvbnN0IG5vUmFuZ2VSZWNvdmVyeSA9ICgpOiBudWxsID0+IG51bGw7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSA9IGNyZWF0ZURpc2tNZW1vU3RvcmVcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQb3N0VG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgY29tbWFuZCA9IG5hcnJvd0FwcGx5UGF0Y2hDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgLy8gU3VwcHJlc3Mgb25seSBhICpjb25maXJtZWQqIG5vbi1zdWNjZXNzLiBBbiB1bnJlY29nbml6ZWQgcmVzcG9uc2Ugc2hhcGVcbiAgICAvLyBwcm9jZWVkcyAod2l0aCBhIHdhcm5pbmcpIHJhdGhlciB0aGFuIHJpc2sgc2tpcHBpbmcgYSByZWFsIGVkaXQncyB0b3VjaC5cbiAgICBjb25zdCBjbGFzc2lmaWNhdGlvbiA9IGNsYXNzaWZ5QXBwbHlQYXRjaFJlc3BvbnNlKGlucHV0LnRvb2xfcmVzcG9uc2UpO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ2ZhaWx1cmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChjbGFzc2lmaWNhdGlvbiA9PT0gJ3Vua25vd24nKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ0NvZGV4IGFwcGx5X3BhdGNoIHRvb2xfcmVzcG9uc2Ugc2hhcGUgdW5yZWNvZ25pemVkOyBydW5uaW5nIHRvdWNoIGRlZmVuc2l2ZWx5Jywge1xuICAgICAgICB0b29sUmVzcG9uc2VUeXBlOiB0eXBlb2YgaW5wdXQudG9vbF9yZXNwb25zZSxcbiAgICAgICAgdG9vbFJlc3BvbnNlS2V5czpcbiAgICAgICAgICBpbnB1dC50b29sX3Jlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiBpbnB1dC50b29sX3Jlc3BvbnNlID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgPyBPYmplY3Qua2V5cyhpbnB1dC50b29sX3Jlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcblxuICAgIC8vIE9uZSBlbnZlbG9wZSBtYXkgdG91Y2ggc2V2ZXJhbCBmaWxlczsgZm9yY2Ugd2hvbGUtZmlsZSBhbmNob3JzIChDb2RleCBuZXZlclxuICAgIC8vIHJlY292ZXJzIGEgcG9zdC1lZGl0IHJhbmdlKSBhbmQgcnVuIHRoZSBzaGFyZWQgdG91Y2ggY29yZSBwZXIgdG91Y2hlZCBmaWxlLlxuICAgIC8vIFRoZSBzaGFyZWQgbWVtbyBkZWR1cGVzIHNwYW4gcmVuZGVycyBhY3Jvc3MgYW5jaG9ycyBhbmQgdGhlIHNlc3Npb24uXG4gICAgY29uc3QgYW5jaG9ycyA9IHBhcnNlQXBwbHlQYXRjaChjb21tYW5kLCBub1JhbmdlUmVjb3ZlcnkpO1xuICAgIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgICBjb25zdCBhYnNQYXRoID0gYWJzcGF0aEFnYWluc3QoY3dkLCBhbmNob3IucGF0aCk7XG4gICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhcbiAgICAgICAgeyBraW5kOiAnd3JpdGUnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGg6IGFic1BhdGgsIHdyaXR0ZW46ICcnIH0sXG4gICAgICAgIGV4ZWN1dG9ycyxcbiAgICAgICAgbWVtb1xuICAgICAgKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuXG4gICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkLCBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZCB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ2FwcGx5X3BhdGNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vcG9zdC10b29sLXVzZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFL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QkFBb0IsWUFBWTtBQUM3QyxNQUFJLFNBQVMsS0FBTSxRQUFPO0FBQzFCLFNBQU8sS0FBSyxXQUFXLDBCQUEwQixJQUFJLFlBQVk7QUFDbkU7QUFHQSxJQUFNLGtCQUFrQixNQUFZO0FBRTdCLFNBQVMsY0FDZCxZQUE0Qiw0QkFBNEIsR0FDeEQsY0FBMkIscUJBQzNCO0FBQ0EsU0FBTyxPQUFPLE9BQXlCLFFBQXFCO0FBQzFELFVBQU0sVUFBVSx3QkFBd0IsTUFBTSxVQUFVO0FBQ3hELFFBQUksWUFBWSxLQUFNLFFBQU87QUFJN0IsVUFBTSxpQkFBaUIsMkJBQTJCLE1BQU0sYUFBYTtBQUNyRSxRQUFJLG1CQUFtQixVQUFXLFFBQU87QUFDekMsUUFBSSxtQkFBbUIsV0FBVztBQUNoQyxVQUFJLE9BQU8sS0FBSyxpRkFBaUY7QUFBQSxRQUMvRixrQkFBa0IsT0FBTyxNQUFNO0FBQUEsUUFDL0Isa0JBQ0UsTUFBTSxrQkFBa0IsUUFBUSxPQUFPLE1BQU0sa0JBQWtCLFdBQzNELE9BQU8sS0FBSyxNQUFNLGFBQXdDLElBQzFEO0FBQUEsTUFDUixDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sTUFBTSxNQUFNLE9BQU87QUFDekIsVUFBTSxZQUFZLE1BQU07QUFDeEIsVUFBTSxPQUFPLFlBQVksSUFBSSxNQUFNO0FBS25DLFVBQU0sVUFBVSxnQkFBZ0IsU0FBUyxlQUFlO0FBQ3hELFVBQU0sU0FBbUIsQ0FBQztBQUMxQixlQUFXLFVBQVUsU0FBUztBQUM1QixZQUFNLFVBQVUsZUFBZSxLQUFLLE9BQU8sSUFBSTtBQUMvQyxZQUFNLFFBQVEsa0JBQWtCLEtBQUssT0FBTztBQUM1QyxVQUFJLENBQUMsTUFBTztBQUNaLFlBQU0sU0FBUyxNQUFNO0FBQUEsUUFDbkIsRUFBRSxNQUFNLFNBQVMsV0FBVyxLQUFLLFVBQVUsU0FBUyxTQUFTLEdBQUc7QUFBQSxRQUNoRTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQ0EsVUFBSSxPQUFPLGtCQUFtQixRQUFPLEtBQUssT0FBTyxpQkFBaUI7QUFBQSxJQUNwRTtBQUVBLFFBQUksT0FBTyxXQUFXLEVBQUcsUUFBTztBQUNoQyxVQUFNLFdBQVcsT0FBTyxLQUFLLEVBQUU7QUFDL0IsV0FBTyxrQkFBa0IsRUFBRSxtQkFBbUIsVUFBVSxlQUFlLFNBQVMsQ0FBQztBQUFBLEVBQ25GO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsZUFBZSxTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQ3JKM0YsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAibG9nZ2VyIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJiYXNlbmFtZSIsICJiYXNlbmFtZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAidG9Qb3NpeCIsICJjdHgiLCAicmVjb3ZlclJhbmdlIl0KfQo=
