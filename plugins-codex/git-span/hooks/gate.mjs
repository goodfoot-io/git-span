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

// src/common/gate-core.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs4 from "node:fs";
import * as nodePath4 from "node:path";

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
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
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
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
function isEnvironmentalStatus(status) {
  switch (status) {
    case "CONFLICT":
    case "SUBMODULE":
    case "LFS_NOT_FETCHED":
    case "LFS_NOT_INSTALLED":
    case "PROMISOR_MISSING":
    case "SPARSE_EXCLUDED":
    case "FILTER_FAILED":
    case "IO_ERROR":
      return true;
    default:
      return false;
  }
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
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function resolveGitCommonDir(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });
  const trimmed = toPosix(out.trim());
  if (!nodePath.isAbsolute(trimmed)) {
    return toPosix(nodePath.resolve(repoRoot, trimmed));
  }
  return trimmed;
}
function queueRoot(repoRoot) {
  return nodePath.join(resolveGitCommonDir(repoRoot), "git-span");
}
function gateMemoDir(repoRoot) {
  return nodePath.join(queueRoot(repoRoot), "gate");
}

// src/common/gate-ignore.ts
import * as fs3 from "node:fs";
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

// src/common/gate-ignore.ts
var GATE_IGNORE_REL = nodePath3.join(".span", ".gateignore");
function parseGateIgnore(content) {
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const pattern = rawLine.trim();
    if (!pattern || pattern.startsWith("#")) continue;
    rules.push({ pattern, matches: compilePattern(pattern) });
  }
  return rules;
}
function loadGateIgnore(repoRoot) {
  try {
    const content = fs3.readFileSync(nodePath3.join(repoRoot, GATE_IGNORE_REL), "utf8");
    return parseGateIgnore(content);
  } catch {
    return [];
  }
}
function isGateIgnored(rules, repoRelPath) {
  return rules.some((rule) => rule.matches(repoRelPath));
}

// src/common/gate-core.ts
var GateScanError = class extends Error {
  detail;
  constructor(detail) {
    super(`git span stale could not complete its scan: ${detail}`);
    this.name = "GateScanError";
    this.detail = detail;
  }
};
function parseGitCommand(command) {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv) continue;
    if (inv.subcommand === "commit") {
      const dashDash = inv.args.indexOf("--");
      const paths = dashDash >= 0 ? inv.args.slice(dashDash + 1).filter((p) => p.length > 0) : [];
      return paths.length > 0 ? { kind: "commit", paths } : { kind: "commit" };
    }
    if (inv.subcommand === "push") {
      return { kind: "push" };
    }
    if (inv.subcommand === "status") {
      return { kind: "status" };
    }
  }
  return { kind: "none" };
}
var COMMIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "-C",
  "--reuse-message",
  "-c",
  "--reedit-message",
  "--author",
  "--date",
  "-t",
  "--template",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--gpg-sign"
]);
function commitStagesAll(command) {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv || inv.subcommand !== "commit") continue;
    const dashDash = inv.args.indexOf("--");
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      if (arg === "--all") return true;
      if (COMMIT_VALUE_OPTIONS.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith("--") && /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return true;
    }
    return false;
  }
  return false;
}
var TWO_CHAR_OPERATORS = /* @__PURE__ */ new Set(["&&", "||"]);
var ONE_CHAR_SEPARATORS = /* @__PURE__ */ new Set([";", "|", "\n", "&", "(", ")"]);
function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(command.slice(i, i + 2))) {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ONE_CHAR_SEPARATORS.has(ch)) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--attr-source",
  "--config-env"
]);
function matchGitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || tokens[i] !== "git") return null;
  i++;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") return null;
    if (!t.startsWith("-")) break;
    i += GIT_VALUE_OPTIONS.has(t) ? 2 : 1;
  }
  if (i >= tokens.length) return null;
  return { subcommand: tokens[i], args: tokens.slice(i + 1) };
}
async function resolveChangeset(kind, all, cwd, git, paths) {
  if (kind === "push") {
    return git.outgoingPaths(cwd);
  }
  if (kind === "status") {
    const [staged2, tracked2] = await Promise.all([git.stagedPaths(cwd), git.trackedModifiedPaths(cwd)]);
    return mergeUniquePaths(staged2, tracked2);
  }
  if (paths && paths.length > 0) {
    return git.pathspecPaths(paths, cwd);
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return staged;
  const tracked = await git.trackedModifiedPaths(cwd);
  return mergeUniquePaths(staged, tracked);
}
function mergeUniquePaths(...groups) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}
async function evaluateGate(paths, cwd, executors, memoState, mode = "enforce") {
  if (paths.length === 0) return { decision: "allow", kind: "silent" };
  try {
    await executors.fix(paths, cwd);
    const staleRows = await executors.stale(paths, cwd);
    const debtRows = staleRows.filter((row) => isDebt(row.status));
    const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
    const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));
    if (mode === "inform") {
      if (semantic.length > 0) {
        const seen3 = wasAlreadySeen(memoState, gateStateDigest(semantic, []));
        return {
          decision: "allow",
          kind: "semantic-staleness-info",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "inform", seen3)
        };
      }
      if (environmental.length > 0) {
        return {
          decision: "allow",
          kind: "environmental",
          conditions: environmental,
          reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
        };
      }
      const uncovered2 = await computeUncoveredPaths(paths, cwd, executors);
      if (uncovered2.length === 0) return { decision: "allow", kind: "silent" };
      const seen2 = wasAlreadySeen(memoState, gateStateDigest([], uncovered2));
      return {
        decision: "allow",
        kind: "uncovered-writes-info",
        uncovered: uncovered2,
        reason: renderUncoveredReason(uncovered2, "inform", seen2)
      };
    }
    let semanticAlreadyPresented = false;
    if (semantic.length > 0) {
      const semanticDigest = gateStateDigest(semantic, []);
      if (!memoState.has(semanticDigest)) {
        if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
        const seen2 = wasAlreadySeen(memoState, semanticDigest);
        return {
          decision: "deny",
          kind: "semantic-staleness",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "enforce", seen2)
        };
      }
      semanticAlreadyPresented = true;
    }
    if (environmental.length > 0) {
      return {
        decision: "allow",
        kind: "environmental",
        conditions: environmental,
        reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
      };
    }
    const uncovered = await computeUncoveredPaths(paths, cwd, executors);
    if (uncovered.length === 0) {
      return semanticAlreadyPresented ? { decision: "allow", kind: "already-presented" } : { decision: "allow", kind: "silent" };
    }
    const digest = gateStateDigest([], uncovered);
    if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
    if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
    const seen = wasAlreadySeen(memoState, digest);
    return {
      decision: "deny",
      kind: "uncovered-writes",
      uncovered,
      reason: renderUncoveredReason(uncovered, "enforce", seen)
    };
  } catch (err) {
    if (err instanceof GateScanError) {
      return { decision: "allow", kind: "scan-failed", reason: renderScanFailedReason(err.detail) };
    }
    return { decision: "allow", kind: "silent" };
  }
}
async function computeUncoveredPaths(paths, cwd, executors) {
  if (paths.length < 2) return [];
  const covering = await executors.list(paths, cwd);
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const gateIgnoreRules = repoRoot ? loadGateIgnore(repoRoot) : [];
  return paths.filter((path) => !covered.has(path) && !isInsideSpanRoot(path) && !isGateIgnored(gateIgnoreRules, path));
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function gateStateDigest(findings, uncovered) {
  const findingKeys = findings.map((row) => `${row.status}	${row.name}	${row.path}	${row.start}	${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash("sha256").update(payload).digest("hex");
}
function wasAlreadySeen(memoState, digest) {
  const seenKey = `seen-${digest}`;
  const already = memoState.has(seenKey);
  memoState.record(seenKey);
  return already;
}
async function fetchSpanBlocks(executors, rows, cwd) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  try {
    return await executors.listBlocks(names, cwd);
  } catch {
    return "";
  }
}
function annotateBlocks(blocksText, rows) {
  const remaining = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }
  const out = [];
  let pending = [];
  let inBullets = false;
  const closeBullets = () => {
    for (const row of pending) out.push(`- ${anchorText(row)} \u2014 ${humanStatusLabel(row.status)}`);
    pending = [];
    inBullets = false;
  };
  const trimmed = blocksText.trim();
  if (trimmed.length > 0) {
    for (const line of trimmed.split("\n")) {
      const header = /^## (.+)$/.exec(line);
      if (header) {
        closeBullets();
        out.push(line);
        pending = remaining.get(header[1]) ?? [];
        remaining.delete(header[1]);
        inBullets = true;
        continue;
      }
      if (inBullets && line.startsWith("- ")) {
        const addr = line.slice(2);
        let idx = pending.findIndex((row) => anchorText(row) === addr);
        if (idx === -1) idx = pending.findIndex((row) => addr === row.path || addr.startsWith(`${row.path}#`));
        if (idx >= 0) {
          const [row] = pending.splice(idx, 1);
          out.push(`${line} \u2014 ${humanStatusLabel(row.status)}`);
        } else {
          out.push(line);
        }
        continue;
      }
      if (inBullets) closeBullets();
      out.push(line);
    }
    closeBullets();
  }
  for (const [name, group] of remaining) {
    if (out.length > 0) out.push("", "---", "");
    out.push(`## ${name}`);
    for (const row of group) out.push(`- ${anchorText(row)} \u2014 ${humanStatusLabel(row.status)}`);
  }
  return out.join("\n");
}
function renderStalenessReason(findings, blocksText, mode = "enforce", alreadySeen = false) {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `\`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} -m "..."\``;
  if (alreadySeen) {
    const paths = [...new Set(findings.map((row) => row.path))];
    const closing2 = mode === "enforce" ? `Already flagged above \u2014 update the drifted locations or the description, then retry.` : `Already flagged above \u2014 update the drifted locations or the description.`;
    return [`This change still leaves ${subject} out of date:`, ...paths.map((path) => `- ${path}`), "", closing2].join(
      "\n"
    );
  }
  const closing = mode === "enforce" ? `Update the drifted locations or the description \u2014 ${action} \u2014 then retry. If a dependency no longer holds, tell the user instead.` : `Update the drifted locations or the description \u2014 ${action}. If a dependency no longer holds, tell the user instead.`;
  return [
    `This change leaves ${subject} out of date:`,
    "",
    annotateBlocks(blocksText, findings),
    "",
    "---",
    "",
    closing
  ].join("\n");
}
function renderEnvironmentalReason(conditions, blocksText) {
  return [
    "Could not check these implicit dependencies (unfetched LFS, sparse checkout, or similar) \u2014 not blocking:",
    "",
    annotateBlocks(blocksText, conditions),
    "",
    "---",
    "",
    "Fix the checkout/fetch issue if these dependencies need verifying."
  ].join("\n");
}
function renderScanFailedReason(detail) {
  return [
    "The implicit-dependency check could not run, so this change was NOT verified:",
    `  ${detail}`,
    "",
    "The command proceeds anyway. Fix the scan error if verification matters for this change."
  ].join("\n");
}
function renderUncoveredReason(uncovered, mode = "enforce", alreadySeen = false) {
  const lines = uncovered.map((path) => `- ${path}`);
  if (alreadySeen) {
    const body2 = ["<git-span>", ...lines, "", "Already flagged for git-span review above."];
    if (mode === "enforce") {
      body2.push("", "If none exist, retry the command to proceed (one-time check).");
    }
    body2.push("</git-span>");
    return body2.join("\n");
  }
  const body = [
    "<git-span>",
    ...lines,
    "",
    "Determine if these files carry implicit dependencies, then use `git span` to document them:",
    "",
    "`git span add <name> <path#Lstart-Lend> [<path#Lstart-Lend>] ...`",
    '`git span why <name> -m "<why>"`',
    "",
    'The "<why>" is a single present-tense sentence naming what the ranges form together, specific enough to tell whether an edit lands inside it, with no rules or reminders.'
  ];
  if (mode === "enforce") {
    body.push("", "If none exist, retry the command to proceed (one-time check).");
  }
  body.push("", "Load the `git-span:git-span` skill for guidance.", "</git-span>");
  return body.join("\n");
}
var DEFAULT_TIMEOUT_MS = 1e4;
function gitLines(args, cwd, timeoutMs) {
  try {
    const out = execFileSync2("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs
    });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
  } catch {
    return [];
  }
}
function gitLinesOrNull(args, cwd, timeoutMs) {
  try {
    const out = execFileSync2("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs
    });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
  } catch {
    return null;
  }
}
function createDefaultGitExecutor(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    stagedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, "diff", "--cached", "--name-only"], repoRoot, timeoutMs);
    },
    trackedModifiedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, "diff", "--name-only"], repoRoot, timeoutMs);
    },
    outgoingPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const upstream = gitLinesOrNull(["-C", repoRoot, "diff", "--name-only", "@{u}..HEAD"], repoRoot, timeoutMs);
      if (upstream !== null) return upstream;
      const base = gitLines(["-C", repoRoot, "merge-base", "HEAD", "origin/HEAD"], repoRoot, timeoutMs)[0];
      if (!base) return [];
      return gitLines(["-C", repoRoot, "diff", "--name-only", `${base}..HEAD`], repoRoot, timeoutMs);
    },
    pathspecPaths: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      return gitLines(["-C", repoRoot, "diff", "HEAD", "--name-only", "--", ...paths], repoRoot, timeoutMs);
    }
  };
}
function createDefaultGateExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      try {
        execFileSync2("git", ["span", "stale", ...paths, "--fix"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
      }
    },
    stale: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      let out;
      try {
        out = execFileSync2("git", ["span", "stale", "--format", "porcelain", ...paths], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        const stdout = err.stdout;
        const stderr = err.stderr;
        const stdoutText = typeof stdout === "string" ? stdout : "";
        const stderrText = typeof stderr === "string" ? stderr : "";
        if (stdoutText.trim().length === 0 && stderrText.trim().length > 0) {
          throw new GateScanError(stderrText.trim());
        }
        out = stdoutText;
      }
      return parseStalePorcelain(out);
    },
    list: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      try {
        const out = execFileSync2("git", ["span", "list", "--porcelain", ...paths], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    },
    listBlocks: async (names, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return "";
      try {
        return execFileSync2("git", ["span", "list", ...names], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
        return "";
      }
    }
  };
}
function createDiskGateMemoState(cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { has: () => false, record: () => false };
  }
  const dir = gateMemoDir(repoRoot);
  return {
    has: (digest) => {
      try {
        return fs4.existsSync(nodePath4.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs4.mkdirSync(dir, { recursive: true });
        fs4.writeFileSync(nodePath4.join(dir, digest), "");
        return true;
      } catch {
        return false;
      }
    }
  };
}

// src/codex/gate.ts
var CODEX_GATE_HARD_DENY = true;
function extractShellCommand(toolInput) {
  if (toolInput === null || typeof toolInput !== "object" || !("command" in toolInput)) return null;
  const command = toolInput.command;
  if (typeof command === "string") return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p) => typeof p === "string");
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === "-c" || p === "-lc" || p === "-ic");
    if (flagIdx >= 0 && parts[flagIdx + 1] !== void 0) return parts[flagIdx + 1];
    return parts.join(" ");
  }
  return null;
}
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultGateExecutors(), memoFactory = createDiskGateMemoState, hardDeny = CODEX_GATE_HARD_DENY) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span gate observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return void 0;
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return void 0;
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const mode = parsed.kind === "status" ? "inform" : "enforce";
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd), mode);
      if (result.decision !== "deny") {
        if (result.kind === "environmental" || result.kind === "scan-failed") {
          ctx.logger.warn("git-span gate allowed with an unresolved condition", { reason: result.reason });
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        if (result.kind === "semantic-staleness-info" || result.kind === "uncovered-writes-info") {
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        return void 0;
      }
      if (hardDeny) {
        return preToolUseOutput({
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      const warning = `Could not block this command \u2014 the issue below still needs resolving:
${result.reason}`;
      return preToolUseOutput({ additionalContext: warning, systemMessage: warning });
    } catch (err) {
      ctx.logger.warn("git-span gate failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
var gate_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/gate-entry.ts
execute(gate_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGlzR2F0ZUlnbm9yZWQsIGxvYWRHYXRlSWdub3JlIH0gZnJvbSAnLi9nYXRlLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Nhbi1mYWlsdXJlIHNpZ25hbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFpc2VkIGJ5IHRoZSBgc3RhbGVgIGV4ZWN1dG9yIHdoZW4gYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHNcbiAqIHNjb3BlZCBzY2FuIFx1MjAxNCBhcyBvcHBvc2VkIHRvIGNvbXBsZXRpbmcgYW5kIHJlcG9ydGluZyBkcmlmdC4gYGdpdCBzcGFuIHN0YWxlYFxuICogZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHNpdHVhdGlvbnM6IG9uIGxlZ2l0aW1hdGUgZHJpZnQgKHJlYWxcbiAqIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCkgYW5kIG9uIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnksIGxlYXZpbmcgc3Rkb3V0IGVtcHR5IGFuZCBhbiBlcnJvclxuICogb24gc3RkZXJyKS4gT25seSB0aGUgc2Vjb25kIHRocm93cyB0aGlzLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBjYW4gdGVsbCBhXG4gKiBzY2FuIHRoYXQgKnJhbiBjbGVhbiogKGVtcHR5IHJvd3MpIGZyb20gb25lIHRoYXQgKm5ldmVyIHJhbiogKGVtcHR5IHJvd3NcbiAqIGJlY2F1c2UgaXQgYWJvcnRlZCkgYW5kIHJlZnVzZSB0byByZWFkIHRoZSBsYXR0ZXIgYXMgYSBjbGVhbiBwYXNzLiBgZGV0YWlsYFxuICogY2FycmllcyB0aGUgQ0xJJ3Mgc3RkZXJyIGZvciB0aGUgc3VyZmFjZWQgcmVhc29uLlxuICovXG5leHBvcnQgY2xhc3MgR2F0ZVNjYW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGRldGFpbDogc3RyaW5nKSB7XG4gICAgc3VwZXIoYGdpdCBzcGFuIHN0YWxlIGNvdWxkIG5vdCBjb21wbGV0ZSBpdHMgc2NhbjogJHtkZXRhaWx9YCk7XG4gICAgdGhpcy5uYW1lID0gJ0dhdGVTY2FuRXJyb3InO1xuICAgIHRoaXMuZGV0YWlsID0gZGV0YWlsO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUga2luZCBvZiBnYXRlZCBnaXQgY29tbWFuZCBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIHJlc29sdmVzIHRvLiBgJ25vbmUnYFxuICogaXMgdGhlIGNvbnNlcnZhdGl2ZSBmYWlsLW9wZW4gYW5zd2VyOiBhbnkgc2hhcGUge0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gZG9lc1xuICogbm90IGNvbmZpZGVudGx5IHJlY29nbml6ZSBhcyBhIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgL2BnaXQgc3RhdHVzYCBtYXBzIHRvXG4gKiBgJ25vbmUnYCBhbmQgdGhlIGdhdGUgYWxsb3dzIHRoZSBjb21tYW5kIHRocm91Z2ggdW50b3VjaGVkLiBgJ3N0YXR1cydgIGlzXG4gKiBuZXZlciBkZW5pZWQgXHUyMDE0IHtAbGluayBldmFsdWF0ZUdhdGV9J3MgYCdpbmZvcm0nYCBtb2RlIG9ubHkgZXZlciBhbGxvd3MsXG4gKiBzdXJmYWNpbmcgYW55IHNwYW4gZGVidCBhcyBhZHZpc29yeSBjb250ZXh0LlxuICovXG5leHBvcnQgdHlwZSBHaXRDb21tYW5kS2luZCA9ICdjb21taXQnIHwgJ3B1c2gnIHwgJ3N0YXR1cycgfCAnbm9uZSc7XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBwYXJzaW5nIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgZm9yIGEgZ2F0ZWQgZ2l0IGludm9jYXRpb24uXG4gKlxuICogYHBhdGhzYCBjYXJyaWVzIG9ubHkgd2hhdCBpcyBwYXJzZWFibGUgZnJvbSB0aGUgY29tbWFuZCBsaW5lIGl0c2VsZiBcdTIwMTQgdGhlXG4gKiBleHBsaWNpdCBwYXRoc3BlY3MgYSBgZ2l0IGNvbW1pdCAtLSA8cGF0aD5cdTIwMjZgIGZvcm0gbmFtZXMuIEl0IGlzIGRlbGliZXJhdGVseVxuICogKm5vdCogdGhlIGNoYW5nZXNldDogdGhlIGZ1bGxlciByZXNvbHV0aW9uIChzdGFnZWQgZmlsZXMsIHRoZSBgLWFgL2AtYW1gXG4gKiBleHBhbnNpb24gYWdhaW5zdCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzLCB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSkgaXNcbiAqIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSdzIGpvYiwgZHJpdmVuIGZyb20gdGhlIHJlcG8gc3RhdGUsIG5vdCBmcm9tIHRoZVxuICogY29tbWFuZCB0ZXh0LiBgcGF0aHNgIGlzIG9taXR0ZWQgd2hlbiB0aGUgY29tbWFuZCBuYW1lcyBubyBleHBsaWNpdFxuICogcGF0aHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGtpbmQ6IEdpdENvbW1hbmRLaW5kO1xuICBwYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFdvcmQtYm91bmRhcnkgcGFyc2Ugb2YgYSBgZ2l0IGNvbW1pdGAgLyBgZ2l0IHB1c2hgIC8gYGdpdCBzdGF0dXNgIGludm9jYXRpb25cbiAqIGVtYmVkZGVkIGluIGFuIGFyYml0cmFyeSBzaGVsbCBjb21tYW5kIHN0cmluZy5cbiAqXG4gKiBNdXN0IHJlY29nbml6ZSB0aGUgcmVhbCBzaGFwZXMgY29tbWl0cywgcHVzaGVzLCBhbmQgc3RhdHVzIGNoZWNrcyBhcnJpdmUgaW46XG4gKiBjaGFpbmVkIGNvbW1hbmRzIChgXHUyMDI2ICYmIGdpdCBjb21taXQgXHUyMDI2YCwgYFx1MjAyNjsgZ2l0IHB1c2hgLCBgXHUyMDI2IHwgXHUyMDI2YCksIGFuIGV4cGxpY2l0XG4gKiByZXBvIHZpYSBgZ2l0IC1DIDxkaXI+IGNvbW1pdCBcdTIwMjZgLCB0cmFpbGluZyBwYXRoc3BlY3MgYWZ0ZXIgYC0tYCwgdGhlXG4gKiBgLWFgL2AtYW1gIFwiY29tbWl0IGFsbCB0cmFja2VkLW1vZGlmaWVkXCIgZm9ybXMsIGFuZCBpbnZvY2F0aW9uIGZyb20gYSBjd2RcbiAqIGJlbG93IHRoZSByZXBvIHJvb3QuIE1hdGNoaW5nIGlzIG9uIHdvcmQgYm91bmRhcmllcywgbmV2ZXIgc3Vic3RyaW5nOiBhIHBhdGhcbiAqIG9yIG1lc3NhZ2UgdGhhdCBtZXJlbHkgY29udGFpbnMgdGhlIHRleHQgYGdpdCBjb21taXRgIG11c3Qgbm90IHRyaXAgdGhlXG4gKiBnYXRlLlxuICpcbiAqIENvbnNlcnZhdGl2ZSBieSBjb250cmFjdDogdGhpcyBpcyB0aGUgZmFpbC1vcGVuIHBvaW50IGF0IHRoZSBwYXJzZSBsYXllciwgbm90XG4gKiBhIHBsYWNlIHRvIGd1ZXNzLiBBbnkgY29tbWFuZCB3aG9zZSBzaGFwZSBpcyBub3QgY29uZmlkZW50bHkgYSBnYXRlZFxuICogYGdpdCBjb21taXRgL2BnaXQgcHVzaGAvYGdpdCBzdGF0dXNgIFx1MjAxNCBhbiB1bmZhbWlsaWFyIHN1YmNvbW1hbmQsIGFuIGFsaWFzLCBhblxuICogb2JmdXNjYXRlZCBvciBkeW5hbWljYWxseS1idWlsdCBpbnZvY2F0aW9uIFx1MjAxNCByZXR1cm5zIGB7IGtpbmQ6ICdub25lJyB9YCBzbyB0aGVcbiAqIGdhdGUgYWxsb3dzIGl0IHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYSBzaGFreSByZWFkLiAoU2VlIENBUkQubWQgXCJSaXNrcyBhbmRcbiAqIHJlcXVpcmVkIHNwaWtlcyBcdTIxOTIgQ29tbWFuZCBwYXJzaW5nXCIgYW5kIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEuKVxuICpcbiAqIEBwYXJhbSBjb21tYW5kIFRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgZnJvbSB0aGUgaG9vaydzIHRvb2wgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdpdENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludikgY29udGludWU7XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnY29tbWl0Jykge1xuICAgICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgICAgY29uc3QgcGF0aHMgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoZGFzaERhc2ggKyAxKS5maWx0ZXIoKHApID0+IHAubGVuZ3RoID4gMCkgOiBbXTtcbiAgICAgIHJldHVybiBwYXRocy5sZW5ndGggPiAwID8geyBraW5kOiAnY29tbWl0JywgcGF0aHMgfSA6IHsga2luZDogJ2NvbW1pdCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAncHVzaCcpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICdwdXNoJyB9O1xuICAgIH1cbiAgICBpZiAoaW52LnN1YmNvbW1hbmQgPT09ICdzdGF0dXMnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAnc3RhdHVzJyB9O1xuICAgIH1cbiAgICAvLyBBIHJlY29nbml6ZWQgYGdpdGAgaW52b2NhdGlvbiB0aGF0IGlzIG5laXRoZXIgY29tbWl0LCBwdXNoLCBub3Igc3RhdHVzXG4gICAgLy8gKGUuZy4gYGdpdCBhZGQgLiAmJiBnaXQgY29tbWl0IFx1MjAyNmApOiBrZWVwIHNjYW5uaW5nIGxhdGVyIHNlZ21lbnRzLlxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGNvbW1pdGAgaW4gdGhlIGNvbW1hbmQgaXMgYW4gYC1hYC9gLWFtYC9gLS1hbGxgIGZvcm0gXHUyMDE0IHRoZVxuICogXCJzdGFnZSBhbGwgdHJhY2tlZC1tb2RpZmllZCBmaWxlc1wiIHZhcmlhbnQgd2hvc2UgY2hhbmdlc2V0IHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogbXVzdCB3aWRlbiBiZXlvbmQgdGhlIGFscmVhZHktc3RhZ2VkIHNldC5cbiAqXG4gKiBUaGUgYGFsbGAgc2lnbmFsIGlzIGRlbGliZXJhdGVseSAqbm90KiBjYXJyaWVkIG9uIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogKHNlZSB0aGF0IHR5cGUncyBkb2MpOiB0aGUgYWRhcHRlciBkZXJpdmVzIGl0IGhlcmUgZnJvbSB0aGUgc2FtZSBjb21tYW5kIHRleHRcbiAqIGFuZCB0aHJlYWRzIGl0IGludG8ge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IGV4cGxpY2l0bHkuIENvbnNlcnZhdGl2ZTogb25seSBhXG4gKiBzaG9ydC1mbGFnIGdyb3VwIGNvbnRhaW5pbmcgYGFgIChgLWFgLCBgLWFtYCwgYC1tYWApIG9yIGFuIGV4cGxpY2l0IGAtLWFsbGAsXG4gKiBzY2FubmVkIGJlZm9yZSBhbnkgYC0tYCBwYXRoc3BlYyBzZXBhcmF0b3IsIGNvdW50cy5cbiAqXG4gKiBWYWx1ZS10YWtpbmcgY29tbWl0IG9wdGlvbnMgKGAtbWAsIGAtLW1lc3NhZ2VgLCBgLUZgLCBgLUNgLCBcdTIwMjYpIGNvbnN1bWUgdGhlaXJcbiAqIGZvbGxvd2luZyB0b2tlbiwgc28gaXQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhIGZsYWc6IGEgbWVzc2FnZSB3b3JkIGxpa2VcbiAqIGAtYW5hbHlzaXNgIGluIGBnaXQgY29tbWl0IC1tIFwiLWFuYWx5c2lzXCJgIG11c3Qgbm90IGJlIG1pc3JlYWQgYXMgdGhlXG4gKiBgLS1hbGxgLWVxdWl2YWxlbnQgc2hvcnQtZmxhZyBjbHVzdGVyIGFuZCB3aWRlbiB0aGUgY2hhbmdlc2V0LlxuICovXG5jb25zdCBDT01NSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLW0nLFxuICAnLS1tZXNzYWdlJyxcbiAgJy1GJyxcbiAgJy0tZmlsZScsXG4gICctQycsXG4gICctLXJldXNlLW1lc3NhZ2UnLFxuICAnLWMnLFxuICAnLS1yZWVkaXQtbWVzc2FnZScsXG4gICctLWF1dGhvcicsXG4gICctLWRhdGUnLFxuICAnLXQnLFxuICAnLS10ZW1wbGF0ZScsXG4gICctLWZpeHVwJyxcbiAgJy0tc3F1YXNoJyxcbiAgJy0tdHJhaWxlcicsXG4gICctLWNsZWFudXAnLFxuICAnLS1ncGctc2lnbidcbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbGFnQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYXJnID0gZmxhZ0FyZ3NbaV07XG4gICAgICBpZiAoYXJnID09PSAnLS1hbGwnKSByZXR1cm4gdHJ1ZTtcbiAgICAgIC8vIEEgdmFsdWUtdGFraW5nIG9wdGlvbiBjb25zdW1lcyBpdHMgZm9sbG93aW5nIHRva2VuIFx1MjAxNCBza2lwIHRoYXQgdG9rZW4gc29cbiAgICAgIC8vIGEgbWVzc2FnZS9hdXRob3IvZGF0ZSBhcmd1bWVudCBpcyBuZXZlciBzY2FubmVkIGFzIGFuIGAtYWAgY2x1c3Rlci5cbiAgICAgIGlmIChDT01NSVRfVkFMVUVfT1BUSU9OUy5oYXMoYXJnKSkge1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyB1bmRlciB0aGUgZ2l2ZW4gZXhwbGljaXQgcGF0aHNwZWNzIHdob3NlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnNcbiAgICogZnJvbSBgSEVBRGAgXHUyMDE0IGBnaXQgZGlmZiBIRUFEIC0tbmFtZS1vbmx5IC0tIDxwYXRoc3BlY3M+YC4gVGhpcyBpcyB3aGF0IGFcbiAgICogcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCAoYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmApIGFjdHVhbGx5IGxhbmRzOiB0aGVcbiAgICogY3VycmVudCB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZSBwYXRoc3BlY3MsIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBlbHNlIGlzXG4gICAqIHN0YWdlZC4gVXNlZCB0byBzY29wZSB0aGUgY2hhbmdlc2V0IHdoZW4ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9IGlzXG4gICAqIHByZXNlbnQsIHNvIHRoZSBnYXRlIGV2YWx1YXRlcyBleGFjdGx5IHRoZSBmaWxlcyB0aGlzIGNvbW1pdCB0YWtlcyBcdTIwMTQgbmV2ZXJcbiAgICogYW4gdW5yZWxhdGVkIHN0YWdlZCBmaWxlLCBhbmQgbmV2ZXIgbWlzc2luZyBhIG1vZGlmaWVkLWJ1dC11bnN0YWdlZCBmaWxlXG4gICAqIG5hbWVkIGluIHRoZSBwYXRoc3BlYyAod2hpY2ggYGdpdCBkaWZmIC0tY2FjaGVkYCB3b3VsZCBuZXZlciBzdXJmYWNlKS5cbiAgICovXG4gIHBhdGhzcGVjUGF0aHMocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcmVwby1yZWxhdGl2ZSBwYXRocyBhIGdhdGVkIGNvbW1hbmQgd291bGQgbGFuZCxcbiAqIHNvIHRoZSBnYXRlIGNhbiBzY29wZSBpdHMgc3RhbGVuZXNzL2NvdmVyYWdlIGNoZWNrIHRvIGV4YWN0bHkgdGhhdCBjaGFuZ2VzZXQuXG4gKlxuICogLSBgY29tbWl0YCB3aXRoIGV4cGxpY2l0IGBwYXRoc2AgKGEgYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmAgZm9ybSk6IG9ubHlcbiAqICAgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IHVuZGVyIHRob3NlIHBhdGhzcGVjcyAoYHBhdGhzcGVjUGF0aHNgKSwgc2luY2UgYVxuICogICBwYXRoc3BlYy1zY29wZWQgY29tbWl0IGxhbmRzIGV4YWN0bHkgdGhhdCwgcmVnYXJkbGVzcyBvZiB0aGUgcmVzdCBvZiB0aGVcbiAqICAgc3RhZ2VkIHNldC4gYGFsbGAgaXMgaWdub3JlZCBcdTIwMTQgYC1hYCBhbmQgYW4gZXhwbGljaXQgcGF0aHNwZWMgZG8gbm90IGNvbWJpbmUuXG4gKiAtIGBjb21taXRgLCBubyBgcGF0aHNgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZVxuICogICBjb21tYW5kIHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3Jtc1xuICogICBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgYXJlXG4gKiAgIGlnbm9yZWQuXG4gKiAtIGBzdGF0dXNgOiB0aGUgc3RhZ2VkIHBhdGhzIHBsdXMgdGhlIHRyYWNrZWQtbW9kaWZpZWQgcGF0aHMsIGRlZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgdGhlIHNhbWUgd29ya2luZy10cmVlIHBpY3R1cmUgYGdpdCBzdGF0dXNgIGl0c2VsZiBwcmludHMsIHByZXZpZXdlZCBmb3JcbiAqICAgc3BhbiBkZWJ0LiBgYWxsYC9gcGF0aHNgIGFyZSBub3QgbWVhbmluZ2Z1bCBmb3IgYSBzdGF0dXMgY2hlY2sgYW5kIGFyZVxuICogICBpZ25vcmVkLlxuICpcbiAqIFRoZSBgYWxsYCBmbGFnIGFuZCBgcGF0aHNgIGFyZSB0aHJlYWRlZCBpbiBleHBsaWNpdGx5IChyYXRoZXIgdGhhbiByZWFkIGJhY2tcbiAqIG91dCBvZiB0aGUgY29tbWFuZCkgYmVjYXVzZSB0aGUgY2FsbGVyL2FkYXB0ZXIgZGVyaXZlcyB0aGVtIGZyb20gdGhlIHBhcnNlOlxuICogYHBhdGhzYCBpcyB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZC5wYXRoc30sIGFuZCBgYWxsYCAod2hpY2gge0BsaW5rIFBhcnNlZEdpdENvbW1hbmR9XG4gKiBpbnRlbnRpb25hbGx5IGRvZXMgbm90IGNhcnJ5KSBjb21lcyBmcm9tIHtAbGluayBjb21taXRTdGFnZXNBbGx9LlxuICpcbiAqIEBwYXJhbSBraW5kIFdoZXRoZXIgdGhlIGNoYW5nZXNldCBpcyBhIGNvbW1pdCdzIHN0YWdlZCBzZXQsIGEgcHVzaCdzIHJhbmdlLCBvciBhIHN0YXR1cyBwcmV2aWV3LlxuICogQHBhcmFtIGFsbCBXaGV0aGVyIHRoZSBjb21taXQgd2FzIGFuIGAtYWAvYC1hbWAgZm9ybSAoaWdub3JlZCBmb3IgYHB1c2hgL2BzdGF0dXNgKS5cbiAqIEBwYXJhbSBjd2QgVGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRoZSBnaXQgY29tbWFuZCByYW4gaW4uXG4gKiBAcGFyYW0gZ2l0IFRoZSBpbmplY3RlZCBnaXQgc3VyZmFjZSBiYWNraW5nIHRoZSByZXNvbHV0aW9uLlxuICogQHBhcmFtIHBhdGhzIEV4cGxpY2l0IHBhdGhzcGVjcyBmcm9tIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgLCBpZiBhbnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ2hhbmdlc2V0KFxuICBraW5kOiAnY29tbWl0JyB8ICdwdXNoJyB8ICdzdGF0dXMnLFxuICBhbGw6IGJvb2xlYW4sXG4gIGN3ZDogc3RyaW5nLFxuICBnaXQ6IEdpdEV4ZWN1dG9yLFxuICBwYXRocz86IHN0cmluZ1tdXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGlmIChraW5kID09PSAncHVzaCcpIHtcbiAgICByZXR1cm4gZ2l0Lm91dGdvaW5nUGF0aHMoY3dkKTtcbiAgfVxuICBpZiAoa2luZCA9PT0gJ3N0YXR1cycpIHtcbiAgICBjb25zdCBbc3RhZ2VkLCB0cmFja2VkXSA9IGF3YWl0IFByb21pc2UuYWxsKFtnaXQuc3RhZ2VkUGF0aHMoY3dkKSwgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCldKTtcbiAgICByZXR1cm4gbWVyZ2VVbmlxdWVQYXRocyhzdGFnZWQsIHRyYWNrZWQpO1xuICB9XG4gIC8vIEEgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBvbmx5IHRoZSB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZVxuICAvLyBwYXRoc3BlY3MgXHUyMDE0IHNjb3BlIHRoZSBjaGFuZ2VzZXQgdG8gZXhhY3RseSB0aGF0LCBuZXZlciB0aGUgZnVsbCBzdGFnZWQgc2V0LlxuICBpZiAocGF0aHMgJiYgcGF0aHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBnaXQucGF0aHNwZWNQYXRocyhwYXRocywgY3dkKTtcbiAgfVxuICBjb25zdCBzdGFnZWQgPSBhd2FpdCBnaXQuc3RhZ2VkUGF0aHMoY3dkKTtcbiAgaWYgKCFhbGwpIHJldHVybiBzdGFnZWQ7XG4gIGNvbnN0IHRyYWNrZWQgPSBhd2FpdCBnaXQudHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkKTtcbiAgcmV0dXJuIG1lcmdlVW5pcXVlUGF0aHMoc3RhZ2VkLCB0cmFja2VkKTtcbn1cblxuLyoqIENvbmNhdGVuYXRlIHBhdGggbGlzdHMgaW4gb3JkZXIsIGRyb3BwaW5nIGxhdGVyIGR1cGxpY2F0ZXMgb2YgYW4gZWFybGllciBwYXRoLiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVQYXRocyguLi5ncm91cHM6IHN0cmluZ1tdW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgbWVyZ2VkOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgIGZvciAoY29uc3QgcGF0aCBvZiBncm91cCkge1xuICAgICAgaWYgKHNlZW4uaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKHBhdGgpO1xuICAgICAgbWVyZ2VkLnB1c2gocGF0aCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtZXJnZWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR2F0ZSBldmFsdWF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UgZ2F0ZSBldmFsdWF0aW9uIG5lZWRzIFx1MjAxNCB0aGUgYGZpeGAvYHN0YWxlYC9cbiAqIGBsaXN0YCBhc3luYyBmdW5jdGlvbnMsIG1pcnJvcmluZyBgdG91Y2gtY29yZS50c2AncyBgVG91Y2hFeGVjdXRvcnNgLiBUZXN0c1xuICogaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGE7IHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3NcbiAqIGl0c2VsZi4gQWxsIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVFeGVjdXRvcnMge1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSA8cGF0aHM+IC0tZml4YCBcdTIwMTQgdGhlIGJlbHQtYW5kLWJyYWNlcyBoZWFsIHRoYXRcbiAgICogcnVucyBiZWZvcmUgY2xhc3NpZmljYXRpb24gKHBlciBDQVJELm1kKSwgcmUtYW5jaG9yaW5nIGFueSBwb3NpdGlvbmFsIGRyaWZ0XG4gICAqIGluIHRoZSBjaGFuZ2VzZXQgdGhhdCB0aGUgdG91Y2ggaG9vayBoYXMgbm90IGFscmVhZHkgaGVhbGVkLiBSZXBvcnRzIG5vdGhpbmc7XG4gICAqIGl0cyBlZmZlY3QgaXMgb24gdGhlIHdvcmtpbmcgdHJlZSwgYW5kIHRoZSBzdWJzZXF1ZW50IHtAbGluayBHYXRlRXhlY3V0b3JzLnN0YWxlfVxuICAgKiByZWFkIG9ic2VydmVzIHRoZSBoZWFsZWQgc3RhdGUuXG4gICAqL1xuICBmaXgocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8dm9pZD47XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIGl0c1xuICAgKiBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciBhbW9uZyB0aGUgY2hhbmdlc2V0J3Mgc3BhbnMsIGVtcHR5IHdoZW5cbiAgICogY2xlYW4uIERlYnQgaXMgY2xhc3NpZmllZCBmcm9tIHRoZXNlIHJvd3MgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWxcbiAgICogKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgZGVueS5cbiAgICpcbiAgICogQW4gZW1wdHkgcmVzdWx0IG11c3QgbWVhbiB0aGUgc2NhbiAqcmFuIGFuZCBmb3VuZCBub3RoaW5nKiwgbmV2ZXIgdGhhdCB0aGVcbiAgICogc2NhbiAqY291bGQgbm90IHJ1biouIFdoZW4gdGhlIHNjb3BlZCBxdWVyeSBhYm9ydHMgYmVmb3JlIGNvbXBsZXRpbmcgKGUuZy5cbiAgICogYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSksIHRoZSBpbXBsZW1lbnRhdGlvbiB0aHJvd3Mge0BsaW5rIEdhdGVTY2FuRXJyb3J9XG4gICAqIHJhdGhlciB0aGFuIHJldHVybmluZyBgW11gLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBkb2VzIG5vdCBtaXN0YWtlIGFuXG4gICAqIGFib3J0ZWQgc2NhbiBmb3IgYSBjbGVhbiBvbmUgYW5kIHNpbGVudGx5IGFsbG93IHVudmVyaWZpZWQgZGVidCB0aHJvdWdoLlxuICAgKi9cbiAgc3RhbGUocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8U3RhbGVQb3JjZWxhaW5Sb3dbXT47XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiB0aGUgY292ZXJpbmdcbiAgICogYW5jaG9ycy4gVXNlZCB0byBjb21wdXRlICp1bmNvdmVyZWQgd3JpdGVzKjogYSBjaGFuZ2VkIHBhdGggd2l0aCB6ZXJvXG4gICAqIGNvdmVyaW5nIHJvd3MgaGVyZSAobWludXMgYC5zcGFuLyoqYCwgZ2l0aWdub3JlZCBwYXRocywgYW5kXG4gICAqIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAtZXhjbHVkZWQgcGF0aHMgXHUyMDE0IHNlZSB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9KVxuICAgKiBpcyBhbiB1bmNvdmVyZWQgd3JpdGUuXG4gICAqL1xuICBsaXN0KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBgZ2l0IHNwYW4gbGlzdCA8bmFtZXMuLi4+YCAoaHVtYW4gZm9ybWF0KSBhbmQgcmV0dXJuIGl0cyByYXcgc3Rkb3V0IFx1MjAxNFxuICAgKiBvbmUgYCMjIDxuYW1lPmAgYmxvY2sgcGVyIHNwYW4gKGFuY2hvciBidWxsZXRzICsgZGVzY3JpcHRpb24pLCBibG9ja3NcbiAgICogc2VwYXJhdGVkIGJ5IGAtLS1gLiBUaGUgZGVueS9hZHZpc29yeSByZW5kZXJlcnMgYW5ub3RhdGUgdGhlc2UgYmxvY2tzIHdpdGhcbiAgICogcGVyLWFuY2hvciBkcmlmdCBsYWJlbHMgc28gdGhlIHN1cmZhY2VkIG1lc3NhZ2UgY2FycmllcyB0aGUgZnVsbCBzcGFuXG4gICAqIChhbGwgbG9jYXRpb25zICsgZGVzY3JpcHRpb24pLCBub3QganVzdCB0aGUgZHJpZnRlZCByb3dzLiBSZXR1cm5zIGAnJ2Agb25cbiAgICogYW55IGZhaWx1cmU7IHtAbGluayBhbm5vdGF0ZUJsb2Nrc30gdGhlbiBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2NrcyBmcm9tXG4gICAqIHRoZSBmaW5kaW5ncyB0aGVtc2VsdmVzIHNvIG5vIGZpbmRpbmcgaXMgZHJvcHBlZC5cbiAgICovXG4gIGxpc3RCbG9ja3MobmFtZXM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPjtcbn1cblxuLyoqXG4gKiBUaGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgbWVtbyBcdTIwMTQgXCJoYXZlIEkgYWxyZWFkeSBwcmVzZW50ZWQgdGhpcyBleGFjdCBkZWJ0XG4gKiBzdGF0ZSBvbmNlP1wiIFRoZSBwZXJzaXN0ZWQgdW5pdCBpcyBhIGRpZ2VzdCBvZiB0aGUgc29ydGVkIHN0YWxlbmVzcyBmaW5kaW5nc1xuICogcGx1cyB0aGUgc29ydGVkIHVuY292ZXJlZCBwYXRocyAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSdzIFwiZ2F0ZSBvbmNlIHBlclxuICogZGlzdGluY3QgZGVidC1zdGF0ZVwiKTsgdGhlIGRpc2stYmFja2VkIGltcGxlbWVudGF0aW9uIHN0b3JlcyBvbmUgbWFya2VyIHBlclxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIHdoZXJlXG4gKiBwcmVzZW5jZSBtZWFucyBcImFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCIgSW5qZWN0ZWQgYXMgYSBzdG9yZSBhYnN0cmFjdGlvblxuICogKGxpa2Ugc3Bhbi1zdXJmYWNlLnRzJ3MgYE1lbW9TdG9yZWApIHNvIFBoYXNlIDMuMiBmYWtlcyBpdCBpbiBtZW1vcnkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZU1lbW9TdGF0ZSB7XG4gIC8qKiBXaGV0aGVyIHRoaXMgZXhhY3QgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIGFscmVhZHkgYmVlbiBwcmVzZW50ZWQgb25jZS4gKi9cbiAgaGFzKGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFJlY29yZCB0aGF0IHRoaXMgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIG5vdyBiZWVuIHByZXNlbnRlZCwgcmV0dXJuaW5nXG4gICAqIHdoZXRoZXIgdGhlIHJlY29yZCBhY3R1YWxseSBwZXJzaXN0ZWQuIGBmYWxzZWAgbWVhbnMgdGhlIG1lbW8gY291bGQgbm90IGJlXG4gICAqIHdyaXR0ZW4gKGUuZy4gYW4gdW53cml0YWJsZSBtZW1vIGRpcmVjdG9yeSkgXHUyMDE0IHRoZSBnYXRlIHRyZWF0cyB0aGF0IGFzIGFcbiAgICogZmFpbC1vcGVuIHNpZ25hbCByYXRoZXIgdGhhbiBkZW55aW5nLCBiZWNhdXNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZFxuICAgKiBzaWxlbnRseSB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSBpZGVudGljYWwgcmV0cnlcIiBpbnRvIFwiZGVueSBldmVyeVxuICAgKiB0aW1lXCIgd2l0aCBubyBlc2NhcGUuXG4gICAqL1xuICByZWNvcmQoZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFRoZSBnYXRlJ3MgZGVjaXNpb24gZm9yIG9uZSBjb21tYW5kLCBhcyBhIGRpc2NyaW1pbmF0ZWQgdW5pb24gdGhlIGFkYXB0ZXJcbiAqIHRyYW5zbGF0ZXMgaW50byBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgL2FsbG93IChDbGF1ZGUpIG9yIGEgYmxvY2svYWxsb3dcbiAqIChDb2RleCkuIGBkZWNpc2lvbmAgaXMgdGhlIGNvYXJzZSBhbGxvdy9kZW55IHRoZSBoYXJuZXNzIGFjdHMgb247IGBraW5kYFxuICogcmVjb3JkcyAqd2h5Kiwgc28gdGhlIGFkYXB0ZXIgcmVuZGVycyB0aGUgcmlnaHQgbWVzc2FnZSBhbmQgc28gdGVzdHMgYXNzZXJ0XG4gKiB0aGUgZXhhY3QgYnJhbmNoLlxuICpcbiAqIC0gYGFsbG93YCAvIGBzaWxlbnRgIFx1MjAxNCBub3RoaW5nIHRvIGNoZWNrIChubyBwYXRocykgb3IgdGhlIGNoYW5nZXNldCBpcyBjbGVhbjtcbiAqICAgYWxsb3cgd2l0aCBubyBvdXRwdXQuIEludGVybmFsIGVycm9ycyBhbmQgcGFyc2UgZmFpbHVyZXMgYWxzbyByZXNvbHZlIGhlcmU6XG4gKiAgIHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG11c3QgbmV2ZXIgYnJpY2sgYSBjb21taXQuXG4gKiAtIGBhbGxvd2AgLyBgYWxyZWFkeS1wcmVzZW50ZWRgIFx1MjAxNCBkZWJ0IGlzIHByZXNlbnQsIGJ1dCB0aGlzIGV4YWN0IGRlYnQgc3RhdGVcbiAqICAgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UgKHNlbWFudGljLXN0YWxlbmVzcyBvciB1bmNvdmVyZWQtd3JpdGVzXG4gKiAgIGNvbnNpZGVyLW9uY2UsIG9yIGFuIHVuY2hhbmdlZCBzdGF0ZSkuIFRoZSBjb21tYW5kIHBhc3Nlcy5cbiAqIC0gYGFsbG93YCAvIGBlbnZpcm9ubWVudGFsYCBcdTIwMTQgdGhlIGNoYW5nZXNldCdzIG9ubHkgc3RhbGVuZXNzIHJvd3MgYXJlXG4gKiAgIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgY29uZGl0aW9ucyAoYENPTkZMSUNUYCwgYFNVQk1PRFVMRWAsIGBMRlNfKmAsXG4gKiAgIGBQUk9NSVNPUl9NSVNTSU5HYCwgYFNQQVJTRV9FWENMVURFRGAsIGBGSUxURVJfRkFJTEVEYCwgYElPX0VSUk9SYCkgdGhlIENMSVxuICogICBjb3VsZCBub3QgcmVzb2x2ZSBhdCBhbGwgXHUyMDE0IG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLlxuICogICBUaGUgZ2F0ZSBmYWlscyBPUEVOIChhbGxvdykgYnV0IGNhcnJpZXMgYGNvbmRpdGlvbnNgL2ByZWFzb25gIHNvIHRoZSBhZGFwdGVyXG4gKiAgIHN1cmZhY2VzIHRoZSBjb25kaXRpb24gaW5zdGVhZCBvZiBzd2FsbG93aW5nIGl0LiBEZW55aW5nIGhlcmUgd291bGQgcmUtZGVueVxuICogICBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gdGhlIGdhdGUuXG4gKiAtIGBhbGxvd2AgLyBgc2Nhbi1mYWlsZWRgIFx1MjAxNCBgZ2l0IHNwYW4gc3RhbGVgIGNvdWxkIG5vdCAqY29tcGxldGUqIGl0cyBzY29wZWRcbiAqICAgc2NhbiAoYSB7QGxpbmsgR2F0ZVNjYW5FcnJvcn0sIGUuZy4gYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSBhYm9ydGluZyB0aGVcbiAqICAgd2hvbGUgcXVlcnkpLiBUaGlzIGlzIGRpc3RpbmN0IGZyb20gYm90aCBgZW52aXJvbm1lbnRhbGAgKHRoZSBzY2FuIGNvbXBsZXRlZFxuICogICBhbmQgY2FycmllZCB0ZXJtaW5hbCByb3dzKSBhbmQgYSBjbGVhbiBwYXNzICh0aGUgc2NhbiBjb21wbGV0ZWQgd2l0aCB6ZXJvXG4gKiAgIHJvd3MpOiB0aGUgc2NhbiBuZXZlciByYW4gdG8gY29tcGxldGlvbiwgc28gaXRzIGVtcHR5IHJlc3VsdCBpcyBub3QgZXZpZGVuY2VcbiAqICAgb2YgXCJubyBkZWJ0LlwiIFRoZSBnYXRlIGZhaWxzIE9QRU4gaGVyZSB0b28gXHUyMDE0IG1hdGNoaW5nIGBlbnZpcm9ubWVudGFsYCBcdTIwMTRcbiAqICAgYnV0IGtlZXBzIGl0cyBvd24gYGtpbmRgIGFuZCBhIGByZWFzb25gIG5hbWluZyB0aGUgZmFpbHVyZSwgc28gdGhlIGFkYXB0ZXJcbiAqICAgc3VyZmFjZXMgYSB3YXJuaW5nIHRoYXQgc3BhbiBkZWJ0IHdhcyBOT1QgdmVyaWZpZWQgZm9yIHRoaXMgY2hhbmdlc2V0XG4gKiAgIGluc3RlYWQgb2Ygc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZTogZXZlcnlcbiAqICAgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqIC0gYGRlbnlgIC8gYHNlbWFudGljLXN0YWxlbmVzc2AgXHUyMDE0IHRoZSBjaGFuZ2VzZXQgY2FycmllcyBzZW1hbnRpYyBzdGFsZW5lc3MsXG4gKiAgIGFuZCB0aGlzIGV4YWN0IGZpbmRpbmdzIGRpZ2VzdCBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueVxuICogICAqKm9uY2UqKiwgbGlzdGluZyBgZmluZGluZ3NgIGFzIGEgY2hlY2tsaXN0IGluIGByZWFzb25gOyBhbiBpZGVudGljYWxcbiAqICAgcmV0cnkgKHVuY2hhbmdlZCBmaW5kaW5ncykgZmFsbHMgdGhyb3VnaCB0byB0aGUgZW52aXJvbm1lbnRhbCBhbmRcbiAqICAgdW5jb3ZlcmVkIGNoZWNrcyBhbmQgcmVzb2x2ZXMgdG8gYGFscmVhZHktcHJlc2VudGVkYCB3aGVuIG90aGVyd2lzZVxuICogICBjbGVhbi4gQ2hhbmdlZCBmaW5kaW5ncyAoYSBuZXcgZGlnZXN0KSBkZW55IGZyZXNoIChjb25zaWRlci1vbmNlIHBlclxuICogICBkaXN0aW5jdCBkZWJ0IHN0YXRlLCBwZXIgZGVzaWduLWRlY2lzaW9ucy5tZCAjMSkuXG4gKiAtIGBkZW55YCAvIGB1bmNvdmVyZWQtd3JpdGVzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBoYXMgY2hhbmdlZCBmaWxlcyBubyBzcGFuXG4gKiAgIGNvdmVycywgYW5kIHRoaXMgc3RhdGUgaGFzIG5vdCBiZWVuIHByZXNlbnRlZCBiZWZvcmUuIERlbnkgKipvbmNlKiosIGxpc3RpbmdcbiAqICAgYHVuY292ZXJlZGA7IHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZSByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgXG4gKiAgIGFuZCBwYXNzZXMgKGNvbnNpZGVyLW9uY2UsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMzKS5cbiAqIC0gYGFsbG93YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3MtaW5mb2AsIGBhbGxvd2AgLyBgdW5jb3ZlcmVkLXdyaXRlcy1pbmZvYCBcdTIwMTRcbiAqICAgYCdpbmZvcm0nYC1tb2RlLW9ubHkgY291bnRlcnBhcnRzIG9mIHRoZSB0d28gYGRlbnlgIGtpbmRzIGFib3ZlOiBzYW1lXG4gKiAgIGBmaW5kaW5nc2AvYHVuY292ZXJlZGAvYHJlYXNvbmAgcGF5bG9hZCwgYnV0IG5ldmVyIGRlbmllcyBhbmQgbmV2ZXJcbiAqICAgY29uc3VsdHMgb3Igd3JpdGVzIGBtZW1vU3RhdGVgIChhIGBnaXQgc3RhdHVzYCBwcmV2aWV3IGlzIG5vdCBhIGRlYnQgc3RhdGVcbiAqICAgdG8gaG9sZCBvciBjb25zaWRlci1vbmNlIFx1MjAxNCBpdCByZS1yZXBvcnRzIHRoZSBzYW1lIGxpdmUgZGVidCBvbiBldmVyeSBjYWxsLFxuICogICBleGFjdGx5IGxpa2UgYGdpdCBzdGF0dXNgIGl0c2VsZiBkb2VzIGZvciB0aGUgd29ya2luZyB0cmVlKS5cbiAqL1xuZXhwb3J0IHR5cGUgR2F0ZVJlc3VsdCA9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NpbGVudCcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdlbnZpcm9ubWVudGFsJzsgY29uZGl0aW9uczogU3RhbGVQb3JjZWxhaW5Sb3dbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdzY2FuLWZhaWxlZCc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzLWluZm8nOyBmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nOyB1bmNvdmVyZWQ6IHN0cmluZ1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnZGVueSc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBXaGV0aGVyIHtAbGluayBldmFsdWF0ZUdhdGV9IG1heSBob2xkIHRoZSBjb21tYW5kIChgJ2VuZm9yY2UnYCwgdGhlIGRlZmF1bHQgXHUyMDE0XG4gKiB1c2VkIGZvciBgY29tbWl0YC9gcHVzaGApIG9yIG11c3Qgb25seSBldmVyIGFkdmlzZSAoYCdpbmZvcm0nYCBcdTIwMTQgdXNlZCBmb3JcbiAqIGBzdGF0dXNgKTogZXZlcnkgYnJhbmNoIHRoYXQgd291bGQgb3RoZXJ3aXNlIGBkZW55YCByZXR1cm5zIGl0cyBgLWluZm9gXG4gKiBgYWxsb3dgIGNvdW50ZXJwYXJ0IGluc3RlYWQsIGFuZCBgbWVtb1N0YXRlYCBpcyBuZXZlciByZWFkIG9yIHdyaXR0ZW4sIHNpbmNlXG4gKiBhbiBpbmZvcm1hdGlvbmFsIHByZXZpZXcgbXVzdCBub3Qgc3BlbmQgKG9yIGJlIGJsb2NrZWQgYnkpIHRoZSBjb25zaWRlci1vbmNlXG4gKiBjcmVkaXQgYSByZWFsIGBjb21taXRgL2BwdXNoYCByZWxpZXMgb24uXG4gKi9cbmV4cG9ydCB0eXBlIEdhdGVNb2RlID0gJ2VuZm9yY2UnIHwgJ2luZm9ybSc7XG5cbi8qKlxuICogRXZhbHVhdGUgdGhlIGdhdGUgZm9yIGEgcmVzb2x2ZWQgY2hhbmdlc2V0IGFuZCBkZWNpZGUgd2hldGhlciB0byBob2xkIHRoZVxuICogY29tbWFuZC5cbiAqXG4gKiBSdW5zIGBleGVjdXRvcnMuZml4YCAoc2NvcGVkIGJlbHQtYW5kLWJyYWNlcyBgc3RhbGUgLS1maXhgKSwgdGhlbiByZWFkc1xuICogYGV4ZWN1dG9ycy5zdGFsZWAgYW5kIGNsYXNzaWZpZXMgZWFjaCBkZWJ0IHJvdyAoYGlzRGVidCgpYCkgaW50byAqc2VtYW50aWMqXG4gKiBkcmlmdCBhbmQgKmVudmlyb25tZW50YWwqIGNvbmRpdGlvbnMgKGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWApLlxuICpcbiAqIFNlbWFudGljIGRyaWZ0IChgQ0hBTkdFRGAvYERFTEVURURgKSBpcyBjaGVja2VkIGFnYWluc3QgYG1lbW9TdGF0ZWAgdmlhIGl0c1xuICogb3duIGRpZ2VzdCAoYGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pYCksIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGVcbiAqIG1lbW8gdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgYWxyZWFkeSB1c2VzOiBub3QgeWV0IHByZXNlbnRlZCBcdTIxOTIgcmVjb3JkIGl0XG4gKiBhbmQgYGRlbnlgL2BzZW1hbnRpYy1zdGFsZW5lc3NgIChhIGBtZW1vU3RhdGUucmVjb3JkYCBmYWlsdXJlIGZhaWxzIG9wZW4gdG9cbiAqIGBhbGxvd2AvYHNpbGVudGAsIHNpbmNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZCByZS1kZW55IHRoZSBpZGVudGljYWxcbiAqIHJldHJ5IGZvcmV2ZXIpOyBhbHJlYWR5IHByZXNlbnRlZCBcdTIxOTIgKipmYWxsIHRocm91Z2gqKiByYXRoZXIgdGhhbiByZXR1cm5pbmcsXG4gKiBzbyBhIHJldHJ5IHN0aWxsIHN1cmZhY2VzIGVudmlyb25tZW50YWwgYWR2aXNvcmllcyBhbmQgc3RpbGwgcnVucyB0aGVcbiAqIHVuY292ZXJlZCBjaGVjay4gV2hldGhlciB0aGUgc2VtYW50aWMgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIGlzXG4gKiB0cmFja2VkIHNvIHRoYXQsIGlmIHRoZSBldmFsdWF0aW9uIHRoZW4gZW5kcyBjbGVhbiwgaXQgcmVzb2x2ZXMgdG9cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCByYXRoZXIgdGhhbiBhIGJhcmUgYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgbWlycm9yaW5nXG4gKiB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuIEEgY2hhbmdlc2V0IGNhcnJ5aW5nIGJvdGhcbiAqIHVucHJlc2VudGVkIHNlbWFudGljIHN0YWxlbmVzcyBhbmQgdW5wcmVzZW50ZWQgdW5jb3ZlcmVkIHdyaXRlcyB0aGVyZWZvcmVcbiAqIGRlbmllcyB0d2ljZSAoc3RhbGVuZXNzIGZpcnN0LCB1bmNvdmVyZWQgb24gdGhlIHJldHJ5KSBiZWZvcmUgYSB0aGlyZFxuICogYXR0ZW1wdCBwYXNzZXM7IGVkaXRpbmcgb25lIHN0YWxlIHNwYW4gd2hpbGUgYW5vdGhlciByZW1haW5zIHN0YWxlIHByb2R1Y2VzXG4gKiBhIG5ldyBmaW5kaW5ncyBzZXQsIGhlbmNlIGEgbmV3IGRpZ2VzdCBhbmQgb25lIGZyZXNoIGRlbnkuIERpZ2VzdCBjb2xsaXNpb25cbiAqIGJldHdlZW4gdGhlIHR3byBjYXRlZ29yaWVzIGlzIGltcG9zc2libGU6IHRoZSBwYXlsb2FkIGlzXG4gKiBgSlNPTi5zdHJpbmdpZnkoe2ZpbmRpbmdzLCB1bmNvdmVyZWR9KWAsIGFuZCB0aGUgc2VtYW50aWMgZGlnZXN0IHBvcHVsYXRlc1xuICogYGZpbmRpbmdzYCB3aGlsZSB0aGUgdW5jb3ZlcmVkIGRpZ2VzdCBwb3B1bGF0ZXMgYHVuY292ZXJlZGAuXG4gKlxuICogRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgYXQgYWxsXG4gKiAoYENPTkZMSUNUYC9gU1VCTU9EVUxFYC9gTEZTXypgL2BQUk9NSVNPUl9NSVNTSU5HYC9gU1BBUlNFX0VYQ0xVREVEYC9cbiAqIGBGSUxURVJfRkFJTEVEYC9gSU9fRVJST1JgKSBcdTIxOTIgYGFsbG93YC9gZW52aXJvbm1lbnRhbGA6IGZhaWwgT1BFTiwgc3VyZmFjaW5nIHRoZVxuICogY29uZGl0aW9uIHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYW4gaW5mcmEgZmFpbHVyZSBhIHNwYW4gZWRpdCBjYW5ub3QgZml4LlxuICogVW5jb3ZlcmVkIHdyaXRlcyAoY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJhZ2UgZnJvbSBgZXhlY3V0b3JzLmxpc3RgLFxuICogbWludXMgYC5zcGFuLyoqYCwgYW5kIHBhdGhzIG1hdGNoZWQgYnkgdGhlIHJlcG8ncyBgLnNwYW4vLmdhdGVpZ25vcmVgIFx1MjAxNCBzZWVcbiAqIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30sIGxvYWRlZCBkaXJlY3RseSBmcm9tIGRpc2sgdmlhXG4gKiBgcmVzb2x2ZVJlcG9Sb290KGN3ZClgLCBmYWlsLW9wZW4gd2hlbiBhYnNlbnQvdW5yZWFkYWJsZSkgXHUyMTkyXG4gKiBgZGVueWAvYHVuY292ZXJlZC13cml0ZXNgIHRoZSBmaXJzdCB0aW1lIHRoYXQgc3RhdGUgaXMgc2VlbiwgdGhlblxuICogYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIG9uIHJldHJ5LiBgTU9WRURgIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBuZXZlciBjb250cmlidXRlIHRvIGFueSBicmFuY2ggYW5kIG5ldmVyIGRlbnkuIEFueSBpbnRlcm5hbCBlcnJvciByZXNvbHZlc1xuICogdG8gYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbmV2ZXIgYnJpY2tzIGEgY29tbWl0LlxuICpcbiAqIEEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWAgaXMgdGhlIG9uZSBjYXNlIGhhbmRsZWRcbiAqIG91dHNpZGUgdGhhdCBmbG93OiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlXG4gKiBhbmNob3IgZmlsZSBhYm9ydHMgdGhlIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVFxuICogZXZpZGVuY2Ugb2YgYSBjbGVhbiBjaGFuZ2VzZXQuIFJlYWRpbmcgdGhhdCBhcyBgYWxsb3dgL2BzaWxlbnRgIHdvdWxkXG4gKiBzaWxlbnRseSBzd2FsbG93IHRoZSBmYWN0IHRoYXQgdmVyaWZpY2F0aW9uIG5ldmVyIGhhcHBlbmVkLCBzbyBpdCByZXNvbHZlc1xuICogaW5zdGVhZCB0byBpdHMgb3duIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCBcdTIwMTQgZmFpbCBPUEVOIGxpa2UgYGVudmlyb25tZW50YWxgXG4gKiAodGhlIGNvbW1hbmQgaXMgbm90IGhlbGQpLCBidXQgd2l0aCBhIGRpc3RpbmN0IGBraW5kYCBhbmQgYHJlYXNvbmAgc28gdGhlXG4gKiBhZGFwdGVyIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzXG4gKiBjaGFuZ2VzZXQgcmF0aGVyIHRoYW4gc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZVxuICogaGVyZTogZXZlcnkgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqXG4gKiBJbiBgJ2luZm9ybSdgIG1vZGUgKGBzdGF0dXNgKSwgdGhlIHNhbWUgY2xhc3NpZmljYXRpb24gcnVucyBidXQgbmVpdGhlclxuICogYGRlbnlgIGJyYW5jaCBmaXJlcyBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuOiBzZW1hbnRpY1xuICogc3RhbGVuZXNzIHJlc29sdmVzIHRvIGBhbGxvd2AvYHNlbWFudGljLXN0YWxlbmVzcy1pbmZvYCBhbmQgdW5jb3ZlcmVkXG4gKiB3cml0ZXMgdG8gYGFsbG93YC9gdW5jb3ZlcmVkLXdyaXRlcy1pbmZvYCwgYm90aCBjYXJyeWluZyB0aGUgc2FtZVxuICogYGZpbmRpbmdzYC9gdW5jb3ZlcmVkYC9gcmVhc29uYCBwYXlsb2FkIHRoZSBgZGVueWAga2luZHMgd291bGQgaGF2ZS4gVGhlXG4gKiBlbnZpcm9ubWVudGFsL3NjYW4tZmFpbGVkL3NpbGVudCBicmFuY2hlcyBhcmUgdW5hZmZlY3RlZCBieSBtb2RlIFx1MjAxNCB0aGV5XG4gKiBhbHJlYWR5IGFsd2F5cyBhbGxvdy5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLiBVbnVzZWQgaW4gYCdpbmZvcm0nYCBtb2RlLlxuICogQHBhcmFtIG1vZGUgYCdlbmZvcmNlJ2AgKGRlZmF1bHQpIG1heSBkZW55OyBgJ2luZm9ybSdgIG9ubHkgZXZlciBhZHZpc2VzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZSxcbiAgbW9kZTogR2F0ZU1vZGUgPSAnZW5mb3JjZSdcbik6IFByb21pc2U8R2F0ZVJlc3VsdD4ge1xuICBpZiAocGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgdHJ5IHtcbiAgICAvLyBCZWx0LWFuZC1icmFjZXMgaGVhbCwgdGhlbiBjbGFzc2lmeSBhZ2FpbnN0IHRoZSBoZWFsZWQgc3RhdGUuXG4gICAgYXdhaXQgZXhlY3V0b3JzLmZpeChwYXRocywgY3dkKTtcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBleGVjdXRvcnMuc3RhbGUocGF0aHMsIGN3ZCk7XG5cbiAgICAvLyBTcGxpdCBkZWJ0IHJvd3MgaW50byBzZW1hbnRpYyBkcmlmdCAoYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4pXG4gICAgLy8gYW5kIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgY29uZGl0aW9ucyAodGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGVcbiAgICAvLyBhbmNob3IgYXQgYWxsIFx1MjAxNCBzcGFyc2UgY2hlY2tvdXQsIHVuZmV0Y2hlZCBMRlMsIHBhcnRpYWwtY2xvbmUgbWlzcywgSS9PXG4gICAgLy8gZXJyb3IpLiBgaXNEZWJ0KClgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciB3aGF0IGlzIGRlYnQgYXQgYWxsO1xuICAgIC8vIGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWAgc3BsaXRzIHRoZSBmaXhhYmxlIGZyb20gdGhlIHVucmVzb2x2YWJsZS5cbiAgICAvLyBgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGNvbnRyaWJ1dGUuXG4gICAgY29uc3QgZGVidFJvd3MgPSBzdGFsZVJvd3MuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgY29uc3Qgc2VtYW50aWMgPSBkZWJ0Um93cy5maWx0ZXIoKHJvdykgPT4gIWlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG4gICAgY29uc3QgZW52aXJvbm1lbnRhbCA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiBpc0Vudmlyb25tZW50YWxTdGF0dXMocm93LnN0YXR1cykpO1xuXG4gICAgaWYgKG1vZGUgPT09ICdpbmZvcm0nKSB7XG4gICAgICAvLyBBIHN0YXR1cyBwcmV2aWV3IG5ldmVyIGRlbmllcyBhbmQgbmV2ZXIgdG91Y2hlcyB0aGUgZW5mb3JjZVxuICAgICAgLy8gY29uc2lkZXItb25jZSBkZW55IGNyZWRpdCBcdTIwMTQgaXQgcmVwb3J0cyB3aGF0ZXZlciBkZWJ0IGlzIGxpdmUgcmlnaHRcbiAgICAgIC8vIG5vdywgZXZlcnkgdGltZSBpdCdzIGFza2VkLiBJdCBkb2VzLCBob3dldmVyLCBtYXJrIHRoZSBkZWJ0IHN0YXRlIGFzXG4gICAgICAvLyBcInNlZW5cIiAoYSBzZXBhcmF0ZSBheGlzIGZyb20gdGhlIGRlbnkgY3JlZGl0KSBzbyBhbiBlbmZvcmNlXG4gICAgICAvLyBldmFsdWF0aW9uIG9mIHRoZSBzYW1lIHVuY2hhbmdlZCBzdGF0ZSBtb21lbnRzIGxhdGVyIFx1MjAxNCBlLmcuIGEgYGdpdFxuICAgICAgLy8gY29tbWl0YCByaWdodCBhZnRlciB0aGUgYGdpdCBzdGF0dXNgIHRoYXQganVzdCBzaG93ZWQgdGhpcyBcdTIwMTQgcmVuZGVyc1xuICAgICAgLy8gYSBjb25kZW5zZWQgcmVtaW5kZXIgaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIGlkZW50aWNhbCBjaGVja2xpc3QuXG4gICAgICBpZiAoc2VtYW50aWMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBzZWVuID0gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlLCBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJyxcbiAgICAgICAgICBmaW5kaW5nczogc2VtYW50aWMsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJTdGFsZW5lc3NSZWFzb24oc2VtYW50aWMsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIHNlbWFudGljLCBjd2QpLCAnaW5mb3JtJywgc2VlbilcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChlbnZpcm9ubWVudGFsLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAgICBraW5kOiAnZW52aXJvbm1lbnRhbCcsXG4gICAgICAgICAgY29uZGl0aW9uczogZW52aXJvbm1lbnRhbCxcbiAgICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVuY292ZXJlZCA9IGF3YWl0IGNvbXB1dGVVbmNvdmVyZWRQYXRocyhwYXRocywgY3dkLCBleGVjdXRvcnMpO1xuICAgICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgZ2F0ZVN0YXRlRGlnZXN0KFtdLCB1bmNvdmVyZWQpKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRlY2lzaW9uOiAnYWxsb3cnLFxuICAgICAgICBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJyxcbiAgICAgICAgdW5jb3ZlcmVkLFxuICAgICAgICByZWFzb246IHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQsICdpbmZvcm0nLCBzZWVuKVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBTZW1hbnRpYyBzdGFsZW5lc3Mgam9pbnMgdGhlIHNhbWUgZGlzdGluY3QtZGVidC1zdGF0ZSBtZW1vIHRoZSB1bmNvdmVyZWRcbiAgICAvLyBjaGVjayB1c2VzOiBkZW55IG9uY2UgcGVyIGZpbmRpbmdzIGRpZ2VzdCwgdGhlbiBmYWxsIHRocm91Z2ggKHJhdGhlciB0aGFuXG4gICAgLy8gcmV0dXJuaW5nKSBvbiBhbiBpZGVudGljYWwgcmV0cnkgc28gdGhlIHJlc3Qgb2YgdGhlIGV2YWx1YXRpb24gc3RpbGwgcnVucy5cbiAgICBsZXQgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gZmFsc2U7XG4gICAgaWYgKHNlbWFudGljLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHNlbWFudGljRGlnZXN0ID0gZ2F0ZVN0YXRlRGlnZXN0KHNlbWFudGljLCBbXSk7XG4gICAgICBpZiAoIW1lbW9TdGF0ZS5oYXMoc2VtYW50aWNEaWdlc3QpKSB7XG4gICAgICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZVxuICAgICAgICAvLyByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5IHRpbWVcIiB3aXRoIG5vIGVzY2FwZSBcdTIwMTQgZmFpbCBvcGVuIGluc3RlYWQuXG4gICAgICAgIGlmICghbWVtb1N0YXRlLnJlY29yZChzZW1hbnRpY0RpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgICBjb25zdCBzZWVuID0gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlLCBzZW1hbnRpY0RpZ2VzdCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdkZW55JyxcbiAgICAgICAgICBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJyxcbiAgICAgICAgICBmaW5kaW5nczogc2VtYW50aWMsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJTdGFsZW5lc3NSZWFzb24oc2VtYW50aWMsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIHNlbWFudGljLCBjd2QpLCAnZW5mb3JjZScsIHNlZW4pXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIEVudmlyb25tZW50YWwgY29uZGl0aW9ucyBhcmUgbm90IGEgc3BhbiBlZGl0IGF3YXkgZnJvbSByZXNvbHV0aW9uOiBmYWlsXG4gICAgLy8gT1BFTiAoYWxsb3cpIFx1MjAxNCBidXQgY2FycnkgdGhlbSBzbyB0aGUgYWRhcHRlciBzdXJmYWNlcyB0aGUgY29uZGl0aW9uIHJhdGhlclxuICAgIC8vIHRoYW4gc3dhbGxvd2luZyBpdC4gRGVueWluZyB3b3VsZCByZS1kZW55IGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGVcbiAgICAvLyB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIHRoZSBnYXRlLCBjb250cmFkaWN0aW5nIHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlXG4gICAgLy8gcmVzdCBvZiB0aGUgZ2F0ZSBhbHJlYWR5IGhvbm9ycyBmb3IgQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlIGZhaWx1cmVzLlxuICAgIGlmIChlbnZpcm9ubWVudGFsLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRlY2lzaW9uOiAnYWxsb3cnLFxuICAgICAgICBraW5kOiAnZW52aXJvbm1lbnRhbCcsXG4gICAgICAgIGNvbmRpdGlvbnM6IGVudmlyb25tZW50YWwsXG4gICAgICAgIHJlYXNvbjogcmVuZGVyRW52aXJvbm1lbnRhbFJlYXNvbihlbnZpcm9ubWVudGFsLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBlbnZpcm9ubWVudGFsLCBjd2QpKVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBVbmNvdmVyZWQgd3JpdGVzOiBjaGFuZ2VkIHBhdGhzIHdpdGggemVybyBjb3ZlcmluZyBzcGFuLCBtaW51cyBgLnNwYW4vKipgXG4gICAgLy8gKHNwYW4gcmVwYWlycyByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpXG4gICAgLy8gYW5kIHBhdGhzIHRoZSByZXBvJ3MgdXNlci1vd25lZCBgLnNwYW4vLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzLiBHaXRpZ25vcmVkXG4gICAgLy8gcGF0aHMgbmV2ZXIgcmVhY2ggaGVyZSBcdTIwMTQgZ2l0IGRvZXMgbm90IHN0YWdlL3B1Ymxpc2ggdGhlbS5cbiAgICBjb25zdCB1bmNvdmVyZWQgPSBhd2FpdCBjb21wdXRlVW5jb3ZlcmVkUGF0aHMocGF0aHMsIGN3ZCwgZXhlY3V0b3JzKTtcbiAgICBpZiAodW5jb3ZlcmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZXRyeSB0aGF0IGZlbGwgdGhyb3VnaCBwYXN0IGFuIGFscmVhZHktcHJlc2VudGVkIHNlbWFudGljLXN0YWxlbmVzc1xuICAgICAgLy8gZGlnZXN0IGVuZHMgY2xlYW4gaGVyZTogc3VyZmFjZSBhbHJlYWR5LXByZXNlbnRlZCByYXRoZXIgdGhhbiBhIGJhcmVcbiAgICAgIC8vIHNpbGVudCBhbGxvdywgbWlycm9yaW5nIHRoZSB1bmNvdmVyZWQgYnJhbmNoJ3Mgb3duIG1lbW8taGl0IHJlc3VsdC5cbiAgICAgIHJldHVybiBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWRcbiAgICAgICAgPyB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgICAgICAgOiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIH1cblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS4gKE5vIHNlbWFudGljIHJvd3Mgc3Vydml2ZSB0b1xuICAgIC8vIGhlcmUgdW5wcmVzZW50ZWQgXHUyMDE0IHRoZSBzZW1hbnRpYyBicmFuY2ggYWJvdmUgaGFzIGFscmVhZHkgcmV0dXJuZWQgZm9yXG4gICAgLy8gdGhhdCBjYXNlIFx1MjAxNCBzbyB0aGUgZGlnZXN0J3MgZmluZGluZ3MgY29tcG9uZW50IGlzIGVtcHR5IGFuZCB0aGUgc3RhdGVcbiAgICAvLyBpcyBrZXllZCBieSB0aGUgdW5jb3ZlcmVkIHNldC4pXG4gICAgY29uc3QgZGlnZXN0ID0gZ2F0ZVN0YXRlRGlnZXN0KFtdLCB1bmNvdmVyZWQpO1xuICAgIGlmIChtZW1vU3RhdGUuaGFzKGRpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH07XG4gICAgLy8gQSBub24tcGVyc2lzdGluZyBtZW1vIHdyaXRlIHdvdWxkIHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlIHJldHJ5XCJcbiAgICAvLyBpbnRvIFwiZGVueSBldmVyeSB0aW1lXCIgd2l0aCBubyBlc2NhcGUgXHUyMDE0IGZhaWwgb3BlbiByYXRoZXIgdGhhbiBkZW55LlxuICAgIGlmICghbWVtb1N0YXRlLnJlY29yZChkaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICBjb25zdCBzZWVuID0gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlLCBkaWdlc3QpO1xuICAgIHJldHVybiB7XG4gICAgICBkZWNpc2lvbjogJ2RlbnknLFxuICAgICAga2luZDogJ3VuY292ZXJlZC13cml0ZXMnLFxuICAgICAgdW5jb3ZlcmVkLFxuICAgICAgcmVhc29uOiByZW5kZXJVbmNvdmVyZWRSZWFzb24odW5jb3ZlcmVkLCAnZW5mb3JjZScsIHNlZW4pXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQSBzY2FuIHRoYXQgY291bGQgbm90IENPTVBMRVRFIGlzIG5vdCBhIGNsZWFuIHJlc3VsdCwgYnV0IGl0IGlzIG5vdFxuICAgIC8vIGRlYnQgZWl0aGVyIFx1MjAxNCB0aGVyZSBpcyBub3RoaW5nIGhlcmUgZm9yIGEgdXNlciB0byByZXNvbHZlIGJ5IGVkaXRpbmcgYVxuICAgIC8vIHNwYW4uIEZhaWwgT1BFTiB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgd2FybmluZyBpbnN0ZWFkIG9mXG4gICAgLy8gc2lsZW50bHkgcmVhZGluZyB0aGUgYWJvcnRlZCBzY2FuJ3MgZW1wdHkgcmVzdWx0IGFzIGNsZWFuLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NjYW4tZmFpbGVkJywgcmVhc29uOiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGVyci5kZXRhaWwpIH07XG4gICAgfVxuICAgIC8vIEZhaWwgb3BlbjogYW55IG90aGVyIGludGVybmFsL0NMSSBlcnJvciByZXNvbHZlcyB0byBhbGxvdy4gVGhlIGdhdGUgbXVzdFxuICAgIC8vIG5ldmVyIGJyaWNrIGEgY29tbWl0IG9uIGl0cyBvd24gZmFpbHVyZS5cbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBjaGFuZ2VkIHBhdGhzIHdpdGggemVybyBjb3ZlcmluZyBzcGFuIFx1MjAxNCBtaW51cyBgLnNwYW4vKipgIChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkgYW5kIHBhdGhzIHRoZVxuICogcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcyAoZmFpbC1vcGVuIHdoZW4gYWJzZW50L1xuICogdW5yZWFkYWJsZSkuIFNoYXJlZCBieSBgZXZhbHVhdGVHYXRlYCdzIGAnZW5mb3JjZSdgIGFuZCBgJ2luZm9ybSdgIGJyYW5jaGVzLFxuICogd2hpY2ggZGlmZmVyIG9ubHkgaW4gd2hhdCB0aGV5IGRvIHdpdGggdGhlIHJlc3VsdCAoZGVueS1vbmNlIHZzLiBhblxuICogYWx3YXlzLWZyZXNoIGFkdmlzb3J5KS5cbiAqXG4gKiBBIGNoYW5nZXNldCBvZiBmZXdlciB0aGFuIHR3byBmaWxlcyBjYW4gbmV2ZXIgY2FycnkgYW4gaW1wbGljaXQgKmNyb3NzLWZpbGUqXG4gKiBkZXBlbmRlbmN5IFx1MjAxNCBnaXQtc3BhbiByZWNvcmRzIGNvdXBsaW5ncyBiZXR3ZWVuIGZpbGUvbGluZSByYW5nZXMgYWNyb3NzXG4gKiBmaWxlcyBcdTIwMTQgc28gYSBzaW5nbGUtZmlsZSAob3IgZW1wdHkpIGNoYW5nZXNldCBzaG9ydC1jaXJjdWl0cyB0byBub1xuICogdW5jb3ZlcmVkIHBhdGhzIHJhdGhlciB0aGFuIHByb21wdGluZyBmb3IgYSBjb3VwbGluZyB0aGF0IGNhbm5vdCBleGlzdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVVuY292ZXJlZFBhdGhzKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgaWYgKHBhdGhzLmxlbmd0aCA8IDIpIHJldHVybiBbXTtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChwYXRocywgY3dkKTtcbiAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGNvbnN0IGdhdGVJZ25vcmVSdWxlcyA9IHJlcG9Sb290ID8gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3QpIDogW107XG4gIHJldHVybiBwYXRocy5maWx0ZXIoKHBhdGgpID0+ICFjb3ZlcmVkLmhhcyhwYXRoKSAmJiAhaXNJbnNpZGVTcGFuUm9vdChwYXRoKSAmJiAhaXNHYXRlSWdub3JlZChnYXRlSWdub3JlUnVsZXMsIHBhdGgpKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWJ0LXN0YXRlIGRpZ2VzdCBhbmQgcmVhc29uIHJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBgcGF0aCNMc3RhcnQtTGVuZGAsIG9yIGEgYmFyZSBwYXRoIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFN0YWxlUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbi8qKlxuICogVGhlIGRpc3RpbmN0LWRlYnQtc3RhdGUgZGlnZXN0IChkZXNpZ24tZGVjaXNpb25zLm1kICM5KTogYSBzdGFibGUgaGFzaCBvZiB0aGVcbiAqIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3MgcGx1cyB0aGUgc29ydGVkIHVuY292ZXJlZCBwYXRocy4gUHJlc2VuY2UgaW4gdGhlXG4gKiBtZW1vIG1lYW5zIFwidGhpcyBleGFjdCBzdGF0ZSB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZS5cIlxuICovXG5mdW5jdGlvbiBnYXRlU3RhdGVEaWdlc3QoZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W10sIHVuY292ZXJlZDogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBmaW5kaW5nS2V5cyA9IGZpbmRpbmdzLm1hcCgocm93KSA9PiBgJHtyb3cuc3RhdHVzfVxcdCR7cm93Lm5hbWV9XFx0JHtyb3cucGF0aH1cXHQke3Jvdy5zdGFydH1cXHQke3Jvdy5lbmR9YCkuc29ydCgpO1xuICBjb25zdCBwYXlsb2FkID0gSlNPTi5zdHJpbmdpZnkoeyBmaW5kaW5nczogZmluZGluZ0tleXMsIHVuY292ZXJlZDogWy4uLnVuY292ZXJlZF0uc29ydCgpIH0pO1xuICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHBheWxvYWQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gZXhwbGFpbmVkIHRvIHRoZSBhZ2VudCBpblxuICogZnVsbCBcdTIwMTQgb3J0aG9nb25hbCB0byAoYW5kIGluZGVwZW5kZW50IG9mKSB0aGUgZW5mb3JjZS1vbmx5IGNvbnNpZGVyLW9uY2VcbiAqIGRlbnkgY3JlZGl0IGBldmFsdWF0ZUdhdGVgIHJlYWRzL3dyaXRlcyBvbiB0aGUgc2FtZSBgZGlnZXN0YCB2YWx1ZS4gQSBzaW5nbGVcbiAqIGBnaXQgc3RhdHVzYC9gZ2l0IGFkZGAgcHJldmlldyBhbmQgdGhlIGBnaXQgY29tbWl0YC9gcHVzaGAgdGhhdCBmb2xsb3dzIGl0XG4gKiBtb21lbnRzIGxhdGVyIHJlc29sdmUgdG8gdGhlIHNhbWUgZGlnZXN0IGJ1dCByZWFjaCBgZXZhbHVhdGVHYXRlYCB0aHJvdWdoXG4gKiBkaWZmZXJlbnQgbW9kZXMgKGAnaW5mb3JtJ2AgbmV2ZXIgdG91Y2hlcyB0aGUgZGVueSBjcmVkaXQpOyB3aXRob3V0IGFcbiAqIHNlcGFyYXRlIFwic2VlblwiIGF4aXMsIGJvdGggd291bGQgcmVuZGVyIHRoZSBpZGVudGljYWwgY2hlY2tsaXN0IHZlcmJhdGltIGluXG4gKiB0aGUgc2FtZSB0dXJuIFx1MjAxNCB3aGljaCBpcyBleGFjdGx5IHdoYXQgYSBjYXB0dXJlZCBzZXNzaW9uIHNob3dlZDogYSBzdGF0dXNcbiAqIHByZXZpZXcgaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgYSBjb21taXQgYXR0ZW1wdCBvbiB0aGUgc2FtZSB0d28gZmlsZXMsXG4gKiB0aGUgc2Vjb25kIG1lc3NhZ2UgZGlmZmVyaW5nIG9ubHkgYnkgdGhlIGFwcGVuZGVkIHJldHJ5IHNlbnRlbmNlLiBNYXJraW5nXG4gKiBcInNlZW5cIiBoZXJlIChhbmQgY29uc3VsdGluZyBpdCBiZWZvcmUgcmVuZGVyaW5nKSBsZXRzIGJvdGggYHJlbmRlclN0YWxlbmVzc1JlYXNvbmBcbiAqIGFuZCBgcmVuZGVyVW5jb3ZlcmVkUmVhc29uYCBmYWxsIGJhY2sgdG8gYSBjb25kZW5zZWQgcmVtaW5kZXIgb24gdGhlIHNlY29uZFxuICogc2hvd2luZywgaW4gZWl0aGVyIGRpcmVjdGlvbiAoaW5mb3JtLXRoZW4tZW5mb3JjZSBvciBlbmZvcmNlLXRoZW4taW5mb3JtKSxcbiAqIHdpdGhvdXQgY2hhbmdpbmcgd2hldGhlciBgZW5mb3JjZWAgZGVuaWVzIG9yIGFsbG93cy5cbiAqL1xuZnVuY3Rpb24gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlOiBHYXRlTWVtb1N0YXRlLCBkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBzZWVuS2V5ID0gYHNlZW4tJHtkaWdlc3R9YDtcbiAgY29uc3QgYWxyZWFkeSA9IG1lbW9TdGF0ZS5oYXMoc2VlbktleSk7XG4gIG1lbW9TdGF0ZS5yZWNvcmQoc2VlbktleSk7XG4gIHJldHVybiBhbHJlYWR5O1xufVxuXG4vKipcbiAqIEZldGNoIHRoZSBodW1hbi1mb3JtYXQgYCMjIDxuYW1lPmAgYmxvY2tzIGZvciB0aGUgc3BhbnMgbmFtZWQgaW4gYHJvd3NgLFxuICogZmFpbGluZyB0byBgJydgIChuZXZlciB0aHJvd2luZykgc28gYSBsaXN0IGZhaWx1cmUgY2FuIG5ldmVyIHR1cm4gYSBkZW55XG4gKiBpbnRvIGEgc2lsZW50IGFsbG93IHZpYSB7QGxpbmsgZXZhbHVhdGVHYXRlfSdzIG91dGVyIGNhdGNoIFx1MjAxNFxuICoge0BsaW5rIGFubm90YXRlQmxvY2tzfSBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2NrcyBmcm9tIHRoZSByb3dzIGluc3RlYWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsIHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbmFtZXMgPSBbLi4ubmV3IFNldChyb3dzLm1hcCgocm93KSA9PiByb3cubmFtZSkpXS5zb3J0KCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IGV4ZWN1dG9ycy5saXN0QmxvY2tzKG5hbWVzLCBjd2QpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBBbm5vdGF0ZSBgZ2l0IHNwYW4gbGlzdGAgaHVtYW4gYmxvY2tzIHdpdGggcGVyLWFuY2hvciBkcmlmdCBsYWJlbHM6IGVhY2hcbiAqIGJ1bGxldCB3aG9zZSBhbmNob3IgbWF0Y2hlcyBhIGZpbmRpbmcgZ2FpbnMgYCBcdTIwMTQgPGxhYmVsPmAuIEJ1bGxldHMgYXJlIG9ubHlcbiAqIHRoZSBjb250aWd1b3VzIGAtIGAgcnVuIGRpcmVjdGx5IHVuZGVyIGEgYCMjIDxuYW1lPmAgaGVhZGVyLCBzbyBhXG4gKiBkZXNjcmlwdGlvbiBsaW5lIHRoYXQgaGFwcGVucyB0byBzdGFydCB3aXRoIGAtIGAgaXMgbmV2ZXIgYW5ub3RhdGVkLlxuICogRmluZGluZ3Mgd2hvc2UgYW5jaG9yIGhhcyBubyBtYXRjaGluZyBidWxsZXQgYXJlIGFwcGVuZGVkIHRvIHRoZWlyIHNwYW4nc1xuICogYnVsbGV0IHJ1bjsgc3BhbnMgYWJzZW50IGZyb20gYGJsb2Nrc1RleHRgIGVudGlyZWx5IChvciBhbiBlbXB0eS9mYWlsZWRcbiAqIGxpc3QgcmVhZCkgZ2V0IGEgc3ludGhlc2l6ZWQgbWluaW1hbCBibG9jayBcdTIwMTQgbm8gZmluZGluZyBpcyBldmVyIGRyb3BwZWQuXG4gKi9cbmZ1bmN0aW9uIGFubm90YXRlQmxvY2tzKGJsb2Nrc1RleHQ6IHN0cmluZywgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZyB7XG4gIGNvbnN0IHJlbWFpbmluZyA9IG5ldyBNYXA8c3RyaW5nLCBTdGFsZVBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3QgZ3JvdXAgPSByZW1haW5pbmcuZ2V0KHJvdy5uYW1lKTtcbiAgICBpZiAoZ3JvdXApIGdyb3VwLnB1c2gocm93KTtcbiAgICBlbHNlIHJlbWFpbmluZy5zZXQocm93Lm5hbWUsIFtyb3ddKTtcbiAgfVxuXG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgbGV0IHBlbmRpbmc6IFN0YWxlUG9yY2VsYWluUm93W10gPSBbXTtcbiAgbGV0IGluQnVsbGV0cyA9IGZhbHNlO1xuICBjb25zdCBjbG9zZUJ1bGxldHMgPSAoKTogdm9pZCA9PiB7XG4gICAgZm9yIChjb25zdCByb3cgb2YgcGVuZGluZykgb3V0LnB1c2goYC0gJHthbmNob3JUZXh0KHJvdyl9IFx1MjAxNCAke2h1bWFuU3RhdHVzTGFiZWwocm93LnN0YXR1cyl9YCk7XG4gICAgcGVuZGluZyA9IFtdO1xuICAgIGluQnVsbGV0cyA9IGZhbHNlO1xuICB9O1xuXG4gIGNvbnN0IHRyaW1tZWQgPSBibG9ja3NUZXh0LnRyaW0oKTtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgbGluZSBvZiB0cmltbWVkLnNwbGl0KCdcXG4nKSkge1xuICAgICAgY29uc3QgaGVhZGVyID0gL14jIyAoLispJC8uZXhlYyhsaW5lKTtcbiAgICAgIGlmIChoZWFkZXIpIHtcbiAgICAgICAgY2xvc2VCdWxsZXRzKCk7XG4gICAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgICAgICBwZW5kaW5nID0gcmVtYWluaW5nLmdldChoZWFkZXJbMV0pID8/IFtdO1xuICAgICAgICByZW1haW5pbmcuZGVsZXRlKGhlYWRlclsxXSk7XG4gICAgICAgIGluQnVsbGV0cyA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGluQnVsbGV0cyAmJiBsaW5lLnN0YXJ0c1dpdGgoJy0gJykpIHtcbiAgICAgICAgY29uc3QgYWRkciA9IGxpbmUuc2xpY2UoMik7XG4gICAgICAgIGxldCBpZHggPSBwZW5kaW5nLmZpbmRJbmRleCgocm93KSA9PiBhbmNob3JUZXh0KHJvdykgPT09IGFkZHIpO1xuICAgICAgICBpZiAoaWR4ID09PSAtMSkgaWR4ID0gcGVuZGluZy5maW5kSW5kZXgoKHJvdykgPT4gYWRkciA9PT0gcm93LnBhdGggfHwgYWRkci5zdGFydHNXaXRoKGAke3Jvdy5wYXRofSNgKSk7XG4gICAgICAgIGlmIChpZHggPj0gMCkge1xuICAgICAgICAgIGNvbnN0IFtyb3ddID0gcGVuZGluZy5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgICBvdXQucHVzaChgJHtsaW5lfSBcdTIwMTQgJHtodW1hblN0YXR1c0xhYmVsKHJvdy5zdGF0dXMpfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGluQnVsbGV0cykgY2xvc2VCdWxsZXRzKCk7XG4gICAgICBvdXQucHVzaChsaW5lKTtcbiAgICB9XG4gICAgY2xvc2VCdWxsZXRzKCk7XG4gIH1cblxuICBmb3IgKGNvbnN0IFtuYW1lLCBncm91cF0gb2YgcmVtYWluaW5nKSB7XG4gICAgaWYgKG91dC5sZW5ndGggPiAwKSBvdXQucHVzaCgnJywgJy0tLScsICcnKTtcbiAgICBvdXQucHVzaChgIyMgJHtuYW1lfWApO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGdyb3VwKSBvdXQucHVzaChgLSAke2FuY2hvclRleHQocm93KX0gXHUyMDE0ICR7aHVtYW5TdGF0dXNMYWJlbChyb3cuc3RhdHVzKX1gKTtcbiAgfVxuXG4gIHJldHVybiBvdXQuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwtc3BhbiBjaGVja2xpc3QgYSBzZW1hbnRpYy1zdGFsZW5lc3MgYGRlbnlgIChvciwgaW4gYCdpbmZvcm0nYCBtb2RlLFxuICogYSBgc3RhdHVzYCBhZHZpc29yeSkgcmVuZGVycyBpbnRvIGByZWFzb25gLiBUaGUgY2xvc2luZyBzZW50ZW5jZSBkcm9wcyBcIlx1MjAxNFxuICogdGhlbiByZXRyeVwiIGluIGAnaW5mb3JtJ2AgbW9kZTogYSBgc3RhdHVzYCBjaGVjayBuZXZlciBoZWxkIGFueXRoaW5nLCBzb1xuICogdGhlcmUgaXMgbm90aGluZyB0byByZXRyeS5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3RhbGVuZXNzUmVhc29uKFxuICBmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSxcbiAgYmxvY2tzVGV4dDogc3RyaW5nLFxuICBtb2RlOiBHYXRlTW9kZSA9ICdlbmZvcmNlJyxcbiAgYWxyZWFkeVNlZW4gPSBmYWxzZVxuKTogc3RyaW5nIHtcbiAgY29uc3QgbmFtZXMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93Lm5hbWUpKV07XG4gIGNvbnN0IHN1YmplY3QgPSBuYW1lcy5sZW5ndGggPT09IDEgPyAnYW4gaW1wbGljaXQgZGVwZW5kZW5jeScgOiAnaW1wbGljaXQgZGVwZW5kZW5jaWVzJztcbiAgY29uc3QgbmFtZSA9IG5hbWVzLmxlbmd0aCA9PT0gMSA/IG5hbWVzWzBdIDogJzxuYW1lPic7XG4gIGNvbnN0IGFjdGlvbiA9IGBcXGBnaXQgc3BhbiBhZGQgJHtuYW1lfSA8cGF0aCNMc3RhcnQtTGVuZD5cXGAgLyBcXGBnaXQgc3BhbiB3aHkgJHtuYW1lfSAtbSBcIi4uLlwiXFxgYDtcbiAgaWYgKGFscmVhZHlTZWVuKSB7XG4gICAgY29uc3QgcGF0aHMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93LnBhdGgpKV07XG4gICAgY29uc3QgY2xvc2luZyA9XG4gICAgICBtb2RlID09PSAnZW5mb3JjZSdcbiAgICAgICAgPyBgQWxyZWFkeSBmbGFnZ2VkIGFib3ZlIFx1MjAxNCB1cGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiwgdGhlbiByZXRyeS5gXG4gICAgICAgIDogYEFscmVhZHkgZmxhZ2dlZCBhYm92ZSBcdTIwMTQgdXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24uYDtcbiAgICByZXR1cm4gW2BUaGlzIGNoYW5nZSBzdGlsbCBsZWF2ZXMgJHtzdWJqZWN0fSBvdXQgb2YgZGF0ZTpgLCAuLi5wYXRocy5tYXAoKHBhdGgpID0+IGAtICR7cGF0aH1gKSwgJycsIGNsb3NpbmddLmpvaW4oXG4gICAgICAnXFxuJ1xuICAgICk7XG4gIH1cbiAgY29uc3QgY2xvc2luZyA9XG4gICAgbW9kZSA9PT0gJ2VuZm9yY2UnXG4gICAgICA/IGBVcGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiBcdTIwMTQgJHthY3Rpb259IFx1MjAxNCB0aGVuIHJldHJ5LiBJZiBhIGRlcGVuZGVuY3kgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuYFxuICAgICAgOiBgVXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24gXHUyMDE0ICR7YWN0aW9ufS4gSWYgYSBkZXBlbmRlbmN5IG5vIGxvbmdlciBob2xkcywgdGVsbCB0aGUgdXNlciBpbnN0ZWFkLmA7XG4gIHJldHVybiBbXG4gICAgYFRoaXMgY2hhbmdlIGxlYXZlcyAke3N1YmplY3R9IG91dCBvZiBkYXRlOmAsXG4gICAgJycsXG4gICAgYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dCwgZmluZGluZ3MpLFxuICAgICcnLFxuICAgICctLS0nLFxuICAgICcnLFxuICAgIGNsb3NpbmdcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgYWR2aXNvcnkgc3VyZmFjZWQgd2hlbiB0aGUgY2hhbmdlc2V0J3Mgb25seSBzdGFsZW5lc3MgaXMgZW52aXJvbm1lbnRhbCBcdTIwMTRcbiAqIHRoZSBnYXRlIGFsbG93cyBidXQgc2F5cyB3aHksIHNvIHRoZSB1bnJlc29sdmFibGUgY29uZGl0aW9uIGlzIG5vdCBzaWxlbnRseVxuICogc3dhbGxvd2VkLlxuICovXG5mdW5jdGlvbiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGNvbmRpdGlvbnM6IFN0YWxlUG9yY2VsYWluUm93W10sIGJsb2Nrc1RleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgJ0NvdWxkIG5vdCBjaGVjayB0aGVzZSBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgKHVuZmV0Y2hlZCBMRlMsIHNwYXJzZSBjaGVja291dCwgb3Igc2ltaWxhcikgXHUyMDE0IG5vdCBibG9ja2luZzonLFxuICAgICcnLFxuICAgIGFubm90YXRlQmxvY2tzKGJsb2Nrc1RleHQsIGNvbmRpdGlvbnMpLFxuICAgICcnLFxuICAgICctLS0nLFxuICAgICcnLFxuICAgICdGaXggdGhlIGNoZWNrb3V0L2ZldGNoIGlzc3VlIGlmIHRoZXNlIGRlcGVuZGVuY2llcyBuZWVkIHZlcmlmeWluZy4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IGFuIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCByZXN1bHQgcmVuZGVycyBpbnRvIGByZWFzb25gOiB0aGUgc2NhblxuICogY291bGQgbm90IGNvbXBsZXRlLCBzbyB0aGUgY2hhbmdlc2V0IHdhcyBOT1QgdmVyaWZpZWQgXHUyMDE0IGJ1dCB0aGUgY29tbWFuZFxuICogcHJvY2VlZHMgYW55d2F5IChmYWlsLW9wZW4sIG1hdGNoaW5nIGBlbnZpcm9ubWVudGFsYCkuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNjYW5GYWlsZWRSZWFzb24oZGV0YWlsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgICdUaGUgaW1wbGljaXQtZGVwZW5kZW5jeSBjaGVjayBjb3VsZCBub3QgcnVuLCBzbyB0aGlzIGNoYW5nZSB3YXMgTk9UIHZlcmlmaWVkOicsXG4gICAgYCAgJHtkZXRhaWx9YCxcbiAgICAnJyxcbiAgICAnVGhlIGNvbW1hbmQgcHJvY2VlZHMgYW55d2F5LiBGaXggdGhlIHNjYW4gZXJyb3IgaWYgdmVyaWZpY2F0aW9uIG1hdHRlcnMgZm9yIHRoaXMgY2hhbmdlLidcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgbGlzdCBhbiB1bmNvdmVyZWQtd3JpdGVzIGBkZW55YCAob3IsIGluIGAnaW5mb3JtJ2AgbW9kZSwgYSBgc3RhdHVzYFxuICogYWR2aXNvcnkpIHJlbmRlcnMgaW50byBgcmVhc29uYCwgd3JhcHBlZCBpbiBhIGA8Z2l0LXNwYW4+YCBibG9jayBtYXRjaGluZyB0aGVcbiAqIHRvdWNoIGhvb2sncyBibG9jayBzdHlsaW5nLiBUaGUgXCJyZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZVxuICogY2hlY2spXCIgc2VudGVuY2UgZHJvcHMgZW50aXJlbHkgaW4gYCdpbmZvcm0nYCBtb2RlOiBhIGBzdGF0dXNgIGNoZWNrIG5ldmVyXG4gKiBoZWxkIGFueXRoaW5nLCBzbyB0aGVyZSBpcyBub3RoaW5nIHRvIHJldHJ5IGFuZCBubyBjb25zaWRlci1vbmNlIHN0YXRlIHRvXG4gKiBjbGVhci5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZDogc3RyaW5nW10sIG1vZGU6IEdhdGVNb2RlID0gJ2VuZm9yY2UnLCBhbHJlYWR5U2VlbiA9IGZhbHNlKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSB1bmNvdmVyZWQubWFwKChwYXRoKSA9PiBgLSAke3BhdGh9YCk7XG4gIGlmIChhbHJlYWR5U2Vlbikge1xuICAgIGNvbnN0IGJvZHkgPSBbJzxnaXQtc3Bhbj4nLCAuLi5saW5lcywgJycsICdBbHJlYWR5IGZsYWdnZWQgZm9yIGdpdC1zcGFuIHJldmlldyBhYm92ZS4nXTtcbiAgICBpZiAobW9kZSA9PT0gJ2VuZm9yY2UnKSB7XG4gICAgICBib2R5LnB1c2goJycsICdJZiBub25lIGV4aXN0LCByZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZSBjaGVjaykuJyk7XG4gICAgfVxuICAgIGJvZHkucHVzaCgnPC9naXQtc3Bhbj4nKTtcbiAgICByZXR1cm4gYm9keS5qb2luKCdcXG4nKTtcbiAgfVxuICBjb25zdCBib2R5ID0gW1xuICAgICc8Z2l0LXNwYW4+JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICAnRGV0ZXJtaW5lIGlmIHRoZXNlIGZpbGVzIGNhcnJ5IGltcGxpY2l0IGRlcGVuZGVuY2llcywgdGhlbiB1c2UgYGdpdCBzcGFuYCB0byBkb2N1bWVudCB0aGVtOicsXG4gICAgJycsXG4gICAgJ2BnaXQgc3BhbiBhZGQgPG5hbWU+IDxwYXRoI0xzdGFydC1MZW5kPiBbPHBhdGgjTHN0YXJ0LUxlbmQ+XSAuLi5gJyxcbiAgICAnYGdpdCBzcGFuIHdoeSA8bmFtZT4gLW0gXCI8d2h5PlwiYCcsXG4gICAgJycsXG4gICAgJ1RoZSBcIjx3aHk+XCIgaXMgYSBzaW5nbGUgcHJlc2VudC10ZW5zZSBzZW50ZW5jZSBuYW1pbmcgd2hhdCB0aGUgcmFuZ2VzIGZvcm0gdG9nZXRoZXIsIHNwZWNpZmljIGVub3VnaCB0byB0ZWxsIHdoZXRoZXIgYW4gZWRpdCBsYW5kcyBpbnNpZGUgaXQsIHdpdGggbm8gcnVsZXMgb3IgcmVtaW5kZXJzLidcbiAgXTtcbiAgaWYgKG1vZGUgPT09ICdlbmZvcmNlJykge1xuICAgIGJvZHkucHVzaCgnJywgJ0lmIG5vbmUgZXhpc3QsIHJldHJ5IHRoZSBjb21tYW5kIHRvIHByb2NlZWQgKG9uZS10aW1lIGNoZWNrKS4nKTtcbiAgfVxuICBib2R5LnB1c2goJycsICdMb2FkIHRoZSBgZ2l0LXNwYW46Z2l0LXNwYW5gIHNraWxsIGZvciBndWlkYW5jZS4nLCAnPC9naXQtc3Bhbj4nKTtcbiAgcmV0dXJuIGJvZHkuam9pbignXFxuJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzL2Rpc2stYmFja2VkIGRlcGVuZGVuY2llc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gVGhlIHByb2R1Y3Rpb24gc3VyZmFjZXMgYm90aCBhZGFwdGVycyBpbmplY3QgYnkgZGVmYXVsdCwgZm9sbG93aW5nXG4vLyB0b3VjaC1jb3JlLnRzJ3MgYGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9yc2Agc3R5bGU6IGVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW5cbi8vIG9uIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4vLyBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBubyByZXBvKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHQgc29cbi8vIHRoZSBnYXRlJ3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzIHdpdGhvdXQgdGhlIGFkYXB0ZXIgYWRkaW5nIGl0cyBvd24uXG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDEwXzAwMDtcblxuLyoqIFJ1biBhIGdpdCBjb21tYW5kIGF0IGBjd2RgLCByZXR1cm5pbmcgdHJpbW1lZCBub24tZW1wdHkgUE9TSVggb3V0cHV0IGxpbmVzIChlbXB0eSBvbiBhbnkgZmFpbHVyZSkuICovXG5mdW5jdGlvbiBnaXRMaW5lcyhhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10ge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gICAgcmV0dXJuIG91dFxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lLmxlbmd0aCA+IDApXG4gICAgICAubWFwKHRvUG9zaXgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqXG4gKiBMaWtlIHtAbGluayBnaXRMaW5lc30gYnV0IGRpc3Rpbmd1aXNoZXMgYSAqZmFpbGVkKiBpbnZvY2F0aW9uIChgbnVsbGAgXHUyMDE0IGUuZy5cbiAqIGBAe3V9YCB3aXRoIG5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQpIGZyb20gYSAqc3VjY2Vzc2Z1bCBidXQgZW1wdHkqIHJlc3VsdFxuICogKGBbXWApLCBzbyB0aGUgb3V0Z29pbmctcmFuZ2UgcmVzb2x1dGlvbiBrbm93cyB3aGVuIHRvIHRyeSB0aGUgbWVyZ2UtYmFzZVxuICogZmFsbGJhY2sgcmF0aGVyIHRoYW4gbWlzdGFraW5nIFwibm8gdXBzdHJlYW1cIiBmb3IgXCJub3RoaW5nIHRvIHB1c2hcIi5cbiAqL1xuZnVuY3Rpb24gZ2l0TGluZXNPck51bGwoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlcik6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKiBUaGUgcHJvZHVjdGlvbiB7QGxpbmsgR2l0RXhlY3V0b3J9OiBgZ2l0IGRpZmZgIHJlYWRzIHNjb3BlZCB0byB0aGUgQ1dEIHJlcG8uICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogR2l0RXhlY3V0b3Ige1xuICByZXR1cm4ge1xuICAgIHN0YWdlZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1jYWNoZWQnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICB0cmFja2VkTW9kaWZpZWRQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5J10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgb3V0Z29pbmdQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIGNvbnN0IHVwc3RyZWFtID0gZ2l0TGluZXNPck51bGwoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsICdAe3V9Li5IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgICAgaWYgKHVwc3RyZWFtICE9PSBudWxsKSByZXR1cm4gdXBzdHJlYW07XG4gICAgICAvLyBObyB1cHN0cmVhbSBjb25maWd1cmVkOiBmYWxsIGJhY2sgdG8gdGhlIG1lcmdlLWJhc2Ugd2l0aCB0aGUgZGVmYXVsdFxuICAgICAgLy8gcmVtb3RlIGJyYW5jaCAoYG9yaWdpbi9IRUFEYCkuIElmIHRoYXQgdG9vIGlzIHVucmVzb2x2YWJsZSwgZmFpbCBvcGVuLlxuICAgICAgY29uc3QgYmFzZSA9IGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ21lcmdlLWJhc2UnLCAnSEVBRCcsICdvcmlnaW4vSEVBRCddLCByZXBvUm9vdCwgdGltZW91dE1zKVswXTtcbiAgICAgIGlmICghYmFzZSkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknLCBgJHtiYXNlfS4uSEVBRGBdLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHBhdGhzcGVjUGF0aHM6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIC8vIFdvcmtpbmctdHJlZSBjb250ZW50IHZzIEhFQUQsIHNjb3BlZCB0byB0aGUgcGF0aHNwZWNzIFx1MjAxNCB0aGUgZmlsZXMgYVxuICAgICAgLy8gYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPmAgd291bGQgYWN0dWFsbHkgY2hhbmdlIChzdGFnZWQgb3Igbm90KS5cbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJ0hFQUQnLCAnLS1uYW1lLW9ubHknLCAnLS0nLCAuLi5wYXRoc10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH1cbiAgfTtcbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHYXRlRXhlY3V0b3JzfTogc2NvcGVkIGBnaXQgc3BhbmAgZml4L3N0YWxlL2xpc3QgYXQgdGhlIHJlcG8gcm9vdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdhdGVFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAuLi5wYXRocywgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiBhZnRlciBoZWFsaW5nLCBhbmQgbm9uLXplcm8gb25cbiAgICAgICAgLy8gZ2VudWluZSBmYWlsdXJlOyBlaXRoZXIgd2F5IHRoZSBzdWJzZXF1ZW50IGBzdGFsZWAgcmVhZCBpcyB0aGUgc291cmNlXG4gICAgICAgIC8vIG9mIHRydXRoLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICB9LFxuICAgIHN0YWxlOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIG5vbi16ZXJvIGluIHR3byB2ZXJ5IGRpZmZlcmVudCB3YXlzLCBhbmQgdGhleVxuICAgICAgICAvLyBtdXN0IG5vdCBiZSBjb25mbGF0ZWQ6XG4gICAgICAgIC8vICAtIExlZ2l0aW1hdGUgZHJpZnQ6IHJlYWwgcG9yY2VsYWluIHJvd3Mgb24gc3Rkb3V0IGRlc2NyaWJpbmcgdGhlXG4gICAgICAgIC8vICAgIGRyaWZ0LiBQYXJzZSB0aGVtICh0aGlzIGlzIHRoZSB3aG9sZSBwb2ludCBvZiB0aGUgcmVhZCkuXG4gICAgICAgIC8vICAtIEhhcmQgc2NhbiBmYWlsdXJlOiB0aGUgc2NvcGVkIHF1ZXJ5IGFib3J0ZWQgYmVmb3JlIGNvbXBsZXRpbmcgKGUuZy5cbiAgICAgICAgLy8gICAgYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSksIHdyaXRpbmcgYW4gZXJyb3IgdG8gc3RkZXJyIGFuZCBlbWl0dGluZ1xuICAgICAgICAvLyAgICBlbXB0eSBzdGRvdXQuIEFuIGVtcHR5IHJlc3VsdCBoZXJlIGlzIE5PVCBcImNsZWFuXCIgXHUyMDE0IHRoZSBzY2FuIG5ldmVyXG4gICAgICAgIC8vICAgIHJhbiB0byBjb21wbGV0aW9uIFx1MjAxNCBzbyBzaWduYWwgaXQgZGlzdGluY3RseSByYXRoZXIgdGhhbiBwYXJzaW5nIHRvXG4gICAgICAgIC8vICAgIGBbXWAsIHdoaWNoIHdvdWxkIHJlYWQgYXMgYSBjbGVhbiBwYXNzIGFuZCBzaWxlbnRseSBhbGxvdyB0aGUgY29tbWl0LlxuICAgICAgICBjb25zdCBzdGRvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgY29uc3Qgc3RkZXJyID0gKGVyciBhcyB7IHN0ZGVycj86IHN0cmluZyB9KS5zdGRlcnI7XG4gICAgICAgIGNvbnN0IHN0ZG91dFRleHQgPSB0eXBlb2Ygc3Rkb3V0ID09PSAnc3RyaW5nJyA/IHN0ZG91dCA6ICcnO1xuICAgICAgICBjb25zdCBzdGRlcnJUZXh0ID0gdHlwZW9mIHN0ZGVyciA9PT0gJ3N0cmluZycgPyBzdGRlcnIgOiAnJztcbiAgICAgICAgaWYgKHN0ZG91dFRleHQudHJpbSgpLmxlbmd0aCA9PT0gMCAmJiBzdGRlcnJUZXh0LnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEdhdGVTY2FuRXJyb3Ioc3RkZXJyVGV4dC50cmltKCkpO1xuICAgICAgICB9XG4gICAgICAgIG91dCA9IHN0ZG91dFRleHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VTdGFsZVBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG4gICAgbGlzdDogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIC4uLnBhdGhzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcbiAgICBsaXN0QmxvY2tzOiBhc3luYyAobmFtZXMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgbmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLm5hbWVzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEEgZmFpbGVkIGh1bWFuLWZvcm1hdCByZWFkIG9ubHkgZGVncmFkZXMgdGhlIHJlbmRlcmVkIG1lc3NhZ2VcbiAgICAgICAgLy8gKGFubm90YXRlQmxvY2tzIHN5bnRoZXNpemVzIG1pbmltYWwgYmxvY2tzKTsgbmV2ZXIgYSBnYXRlIGVycm9yLlxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGRpc2stYmFja2VkIHtAbGluayBHYXRlTWVtb1N0YXRlfTogb25lIG1hcmtlciBmaWxlIHBlciBkZWJ0LXN0YXRlXG4gKiBkaWdlc3QgdW5kZXIge0BsaW5rIGdhdGVNZW1vRGlyfSAoYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gKSwgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBmaWxlLWJhY2tlZCBgTWVtb1N0b3JlYCBwYXR0ZXJuLiBUaGUgZGlnZXN0IGlzIGEgaGV4IHNoYTI1NixcbiAqIGEgc2FmZSBmaWxlbmFtZS4gQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogYSBtZW1vIHdob3NlIHJlcG8gY2Fubm90IGJlXG4gKiByZXNvbHZlZCBkZWdyYWRlcyB0byBhIG5vLW9wIHN0b3JlIChuZXZlciBwZXJzaXN0cyBcdTIxOTIgdW5jb3ZlcmVkIHdvdWxkIHJlLWRlbnksXG4gKiBidXQgYW4gdW5yZXNvbHZhYmxlIHJlcG8geWllbGRzIGFuIGVtcHR5IGNoYW5nZXNldCB1cHN0cmVhbSBhbnl3YXkpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUoY3dkOiBzdHJpbmcpOiBHYXRlTWVtb1N0YXRlIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkge1xuICAgIC8vIE5vIHJlc29sdmFibGUgcmVwbyBcdTIxOTIgdGhlIG1lbW8gY2Fubm90IHBlcnNpc3QuIFJlcG9ydCBgZmFsc2VgIGZyb21cbiAgICAvLyBgcmVjb3JkYCBzbyB0aGUgZ2F0ZSBmYWlscyBvcGVuIHJhdGhlciB0aGFuIGRlbnlpbmcgd2l0aCBubyBlc2NhcGUuXG4gICAgcmV0dXJuIHsgaGFzOiAoKSA9PiBmYWxzZSwgcmVjb3JkOiAoKSA9PiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IGRpciA9IGdhdGVNZW1vRGlyKHJlcG9Sb290KTtcbiAgcmV0dXJuIHtcbiAgICBoYXM6IChkaWdlc3QpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBmcy5leGlzdHNTeW5jKG5vZGVQYXRoLmpvaW4oZGlyLCBkaWdlc3QpKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSxcbiAgICByZWNvcmQ6IChkaWdlc3QpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKG5vZGVQYXRoLmpvaW4oZGlyLCBkaWdlc3QpLCAnJyk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEEgZmFpbGVkIG1lbW8gd3JpdGUgbXVzdCBuZXZlciBicmljayB0aGUgY29tbWl0IGFuZCBtdXN0IG5ldmVyXG4gICAgICAgIC8vIHNpbGVudGx5IHJlLWRlbnkgZm9yZXZlcjogcmVwb3J0IHRoZSBmYWlsdXJlIHNvIHRoZSBnYXRlIGZhaWxzIG9wZW4uXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGdhdGUtY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgZ2F0ZSdzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgZ2F0ZSBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgZ2F0ZSBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGdhdGUgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBnYXRlIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnYXRlTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2dhdGUnKTtcbn1cbiIsICIvKipcbiAqIFBhdGggZXhjbHVzaW9uIGxpc3QgZm9yIHRoZSBnYXRlJ3MgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjay5cbiAqXG4gKiBgZXZhbHVhdGVHYXRlYCBpbiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1jb3JlLnRzfSBhbHJlYWR5IGV4Y2x1ZGVzIGAuc3Bhbi8qKmBcbiAqIHBhdGhzIGZyb20gaXRzIHVuY292ZXJlZC13cml0ZXMgY29tcHV0YXRpb24gdW5jb25kaXRpb25hbGx5IChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkuIFRoaXMgbW9kdWxlXG4gKiBhZGRzIGEgc2Vjb25kLCB1c2VyLWRlY2xhcmVkIGV4Y2x1c2lvbiBzb3VyY2Ugb24gdG9wIG9mIHRoYXQ6IGEgcmVwbyBvd25lclxuICogY2FuIGxpc3QgYWRkaXRpb25hbCBwYXRocyB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaG91bGQgbmV2ZXIgZmxhZyBcdTIwMTRcbiAqIGdlbmVyYXRlZCBvdXRwdXQsIHZlbmRvcmVkIGNvZGUsIGFueXRoaW5nIHRoYXQgd2lsbCBuZXZlciBnZXQgYSBzcGFuLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uZ2F0ZWlnbm9yZWAuIFVubGlrZVxuICoge0BsaW5rIGZpbGU6Ly8uL3NwYW4taWdub3JlLnRzfSdzIGAuc3Bhbi8uaG9va2lnbm9yZWAgXHUyMDE0IHdoaWNoIHRoZSBgZ2l0LXNwYW5gXG4gKiBSdXN0IENMSSBhdXRvLWNyZWF0ZXMgd2l0aCBjYW5vbmljYWwgY29udGVudCBcdTIwMTQgYC5nYXRlaWdub3JlYCBpc1xuICogKip1c2VyLW93bmVkKio6IG5vdGhpbmcgY3JlYXRlcyBvciBwb3B1bGF0ZXMgaXQsIHNvIGl0cyBhYnNlbmNlIGlzIHRoZVxuICogbm9ybWFsLCB1bmNvbmZpZ3VyZWQgc3RhdGUsIG5vdCBhIGJyb2tlbiBvbmUuXG4gKlxuICogRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4gKG5vIHRyYWlsaW5nXG4gKiBwcmVmaXggbGlzdCBcdTIwMTQgYSBgLmdhdGVpZ25vcmVgIGxpbmUgZWl0aGVyIGV4Y2x1ZGVzIGEgcGF0aCBmcm9tIHRoZVxuICogdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBvciBpdCBkb2Vzbid0LCB1bmxpa2UgYC5ob29raWdub3JlYCdzIHBlci1zcGFuLXNsdWdcbiAqIHN1cHByZXNzaW9uKTpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL2dlbmVyYXRlZC8qKlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBpZGVudGljYWwgdG8gYC5ob29raWdub3JlYCdzIChzZWUgdGhhdCBtb2R1bGUncyBkb2NcbiAqIGNvbW1lbnQgZm9yIHRoZSBmdWxsIGdyYW1tYXIpIGFuZCByZXVzZXMgaXRzIGNvbXBpbGVkIG1hdGNoZXIgdmlhXG4gKiB7QGxpbmsgY29tcGlsZVBhdHRlcm59IHJhdGhlciB0aGFuIHJlaW1wbGVtZW50aW5nIHBhdGggbWF0Y2hpbmc6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIEZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5nYXRlaWdub3JlYCwgb3IgYSBtYWxmb3JtZWQgbGluZSxcbiAqIHlpZWxkcyBubyBhZGRpdGlvbmFsIGV4Y2x1c2lvbiBcdTIwMTQgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2ltcGx5IGZhbGxzXG4gKiBiYWNrIHRvIHRoZSBgLnNwYW4vKipgLW9ubHkgZXhjbHVzaW9uIGl0IGFscmVhZHkgYXBwbGllcy5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb21waWxlUGF0dGVybiB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBleGNsdWRlZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBHQVRFX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuZ2F0ZWlnbm9yZScpO1xuXG4vKiogUGFyc2UgYC5nYXRlaWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBibGFuayBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdhdGVJZ25vcmUoY29udGVudDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHBhdHRlcm4gPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIXBhdHRlcm4gfHwgcGF0dGVybi5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgZXhjbHVzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgZmFpbHVyZSB5aWVsZHMgYW5cbiAqIGVtcHR5IHJ1bGUgc2V0LCBzbyBhbiBhYnNlbnQvdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzIG5vdGhpbmdcbiAqIGJleW9uZCB0aGUgZ2F0ZSdzIHVuY29uZGl0aW9uYWwgYC5zcGFuLyoqYCBleGNsdXNpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkR2F0ZUlnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBHQVRFX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUdhdGVJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogVHJ1ZSB3aGVuIHNvbWUgcnVsZSBpbiBgcnVsZXNgIG1hdGNoZXMgYHJlcG9SZWxQYXRoYC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dhdGVJZ25vcmVkKHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBydWxlcy5zb21lKChydWxlKSA9PiBydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRHYXRlSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBHYXRlSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IEdhdGVJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IG5laXRoZXIgaW5saW5lIGJ5IHRoZSBQcmVUb29sVXNlIGhvb2tcbiAqIG5vciBpbiB0aGUgU3RvcCBob29rJ3Mgc3RhbGUgLyByZWxhdGVkIHNlY3Rpb25zLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmdhdGVpZ25vcmVgXG4gKiBpbiBgZ2F0ZS1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIENvZGV4IFByZVRvb2xVc2UgZ2F0ZSBob29rIFx1MjAxNCBob2xkIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG9uIHJlYWwgc3BhbiBkZWJ0LFxuICogYW5kIGFkdmlzZSAobmV2ZXIgaG9sZCkgb24gYSBwbGFpbiBgZ2l0IHN0YXR1c2AuXG4gKlxuICogVGhlIENvZGV4IHR3aW4gb2YgW2NsYXVkZS9nYXRlLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jbGF1ZGUvZ2F0ZS50cyk6XG4gKiBzYW1lIHNoYXJlZCBnYXRlLWNvcmUgcGlwZWxpbmUgKHtAbGluayBwYXJzZUdpdENvbW1hbmR9IFx1MjE5MiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIFx1MjE5MiB7QGxpbmsgZXZhbHVhdGVHYXRlfSksIHRyYW5zbGF0ZWQgaW50byBDb2RleCdzIFByZVRvb2xVc2Ugb3V0cHV0IHNoYXBlLiBDb2RleFxuICogZGVsaXZlcnMgYSBzaGVsbCBjb21tYW5kIGFzIGFuIFNESy10eXBlZCBgdW5rbm93bmAgYHRvb2xfaW5wdXRgOyB0aGlzIGhhbmRsZXJcbiAqIG5hcnJvd3MgaXQgKHN0cmluZywgb3IgYSBgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAvYXJndiBhcnJheSkgaW50byB0aGVcbiAqIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlIHBhcnNlcy5cbiAqXG4gKiBcdTI1MDBcdTI1MDAgVW5jb25maXJtZWQgZGVueSAoc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgYWN0dWFsbHkgKmJsb2NrcyogdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUgd2FzIG5ldmVyIGNvbmZpcm1lZCBpbiB0aGlzIHJlcG86IHRoZSBQaGFzZSAwIHNwaWtlIGNvdWxkIG5vdCBnZXQgYVxuICogZnJvbS1zY3JhdGNoIHBsdWdpbiB0byBsb2FkLCBzbyB0aGUgZGVueSBwYXRoIHdhcyBuZXZlciBleGVyY2lzZWQgZW5kLXRvLWVuZC5cbiAqIFRoZSBvbmx5IHBvc2l0aXZlIGV2aWRlbmNlIGlzIGRvY3VtZW50YXJ5IFx1MjAxNCB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FXG4gKiAodGhlIGV4YWN0IHZlcnNpb24gdGhpcyByZXBvIGRlcGVuZHMgb24pIHNoaXBzIGEgd29ya2VkIGBwZXJtaXNzaW9uRGVjaXNpb246XG4gKiAnZGVueSdgIGV4YW1wbGUgbWF0Y2hlZCBvbiBgXCJCYXNoXCJgLiBUaGlzIGFkYXB0ZXIgdGhlcmVmb3JlIHNoaXBzIHRoZSBoYXJkLWRlbnlcbiAqIHBhdGggcGVyIHRoYXQgUkVBRE1FICh7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9ID0gYHRydWVgKSwgYnV0IGtlZXBzIHRoZVxuICogQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIFx1MjAxNCBhIGxvdWQgYGFkZGl0aW9uYWxDb250ZXh0YCB3YXJuaW5nIHRoYXQgYWxsb3dzXG4gKiB0aGUgY29tbWFuZCwgd2l0aCB0aGUgQ0kgcmVjaXBlIGFzIENvZGV4J3MgZW5mb3JjZW1lbnQgYmFja3N0b3AgXHUyMDE0IGFzIGEgY2xlYXJseVxuICogc2VwYXJhYmxlIGJyYW5jaCBiZWhpbmQgdGhhdCBvbmUgY29uc3RhbnQuIElmIGEgbGl2ZSBzZXNzaW9uIHNob3dzIGRlbnkgZG9lc1xuICogbm90IGZpcmUsIGZsaXAge0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSB0byBgZmFsc2VgOyBub3RoaW5nIGVsc2UgY2hhbmdlcy5cbiAqXG4gKiBUaGUgc2hlbGwgdG9vbCdzIGV4YWN0IGB0b29sX25hbWVgIGlzIGxpa2V3aXNlIHVuY29uZmlybWVkICh0aGUgUkVBRE1FJ3NcbiAqIGV4YW1wbGUgdXNlcyBgXCJCYXNoXCJgOyBDb2RleCBDTEkgdHJhbnNjcmlwdHMgaW4gdGhlIHNwaWtlIGxhYmVsZWQgdGhlIGNhbGxcbiAqIGBleGVjYCkuIFRoZSByZWdpc3RyYXRpb24gbWF0Y2hlciBpcyBicm9hZGVuZWQgdG8gdGhlIHBsYXVzaWJsZSBuYW1lcyBzbyB0aGVcbiAqIGhvb2sgYWN0dWFsbHkgZmlyZXMsIGFuZCBldmVyeSBmaXJlIGxvZ3MgdGhlIG9ic2VydmVkIGB0b29sX25hbWVgIHNvIHRoZSBmaXJzdFxuICogbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbCBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvLlxuICpcbiAqIEZhaWwtb3BlbiBhdCBldmVyeSBsYXllcjogZ2F0ZS1jb3JlIHJlc29sdmVzIGludGVybmFsIGVycm9ycyB0byBhbGxvdywgYW5kIHRoaXNcbiAqIGFkYXB0ZXIgd3JhcHMgdGhlIHdob2xlIHBhdGggaW4gYSB0cnkvY2F0Y2ggdGhhdCBhbGxvd3MtYW5kLWxvZ3MgXHUyMDE0IHRoZSBnYXRlXG4gKiBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENvZGV4IENMSVxuICogZGl2aWRlcyB0byBzZWNvbmRzIGF0IGVtaXQpLlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUHJlVG9vbFVzZUlucHV0LCBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQge1xuICBjb21taXRTdGFnZXNBbGwsXG4gIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzLFxuICBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IsXG4gIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICBldmFsdWF0ZUdhdGUsXG4gIHR5cGUgR2F0ZUV4ZWN1dG9ycyxcbiAgdHlwZSBHYXRlTWVtb1N0YXRlLFxuICB0eXBlIEdpdEV4ZWN1dG9yLFxuICBwYXJzZUdpdENvbW1hbmQsXG4gIHJlc29sdmVDaGFuZ2VzZXRcbn0gZnJvbSAnLi4vY29tbW9uL2dhdGUtY29yZS5qcyc7XG5cbi8qKlxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgaXMgdHJ1c3RlZCB0byBibG9jayB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZS4gU2hpcHMgYHRydWVgIChoYXJkIGRlbnkpIHBlciB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FJ3Mgd29ya2VkXG4gKiBleGFtcGxlLiBGbGlwIHRvIGBmYWxzZWAgdG8gYWN0aXZhdGUgdGhlIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBpZiBhIGxpdmVcbiAqIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzIG5vdCBmaXJlIFx1MjAxNCBzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCBhbmQgdGhpc1xuICogZmlsZSdzIGhlYWRlci4gVGhpcyBpcyB0aGUgc2luZ2xlIHN3aXRjaCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGNvZGUgcGF0aHMuXG4gKi9cbmNvbnN0IENPREVYX0dBVEVfSEFSRF9ERU5ZID0gdHJ1ZTtcblxuLyoqXG4gKiBOYXJyb3cgQ29kZXgncyBgdW5rbm93bmAgc2hlbGwgYHRvb2xfaW5wdXRgIGludG8gdGhlIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlXG4gKiBwYXJzZXMuIEhhbmRsZXMgYSBiYXJlIGBjb21tYW5kYCBzdHJpbmcsIGEgc2hlbGwtd3JhcHBlciBhcmd2XG4gKiAoYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gIFx1MjE5MiB0aGUgc2NyaXB0IGFmdGVyIGAtY2AvYC1sY2ApLCBhbmQgYSBkaXJlY3QgYXJndlxuICogKGBbXCJnaXRcIixcImNvbW1pdFwiLFx1MjAyNl1gIFx1MjE5MiBzcGFjZS1qb2luZWQpLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIGNvbW1hbmQgdGV4dCBpc1xuICogcmVjb3ZlcmFibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U2hlbGxDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ID09PSBudWxsIHx8IHR5cGVvZiB0b29sSW5wdXQgIT09ICdvYmplY3QnIHx8ICEoJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkpIHJldHVybiBudWxsO1xuICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQubGVuZ3RoID4gMCA/IGNvbW1hbmQgOiBudWxsO1xuICBpZiAoQXJyYXkuaXNBcnJheShjb21tYW5kKSkge1xuICAgIGNvbnN0IHBhcnRzID0gY29tbWFuZC5maWx0ZXIoKHApOiBwIGlzIHN0cmluZyA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYWdJZHggPSBwYXJ0cy5maW5kSW5kZXgoKHApID0+IHAgPT09ICctYycgfHwgcCA9PT0gJy1sYycgfHwgcCA9PT0gJy1pYycpO1xuICAgIGlmIChmbGFnSWR4ID49IDAgJiYgcGFydHNbZmxhZ0lkeCArIDFdICE9PSB1bmRlZmluZWQpIHJldHVybiBwYXJ0c1tmbGFnSWR4ICsgMV07XG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oJyAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGdpdDogR2l0RXhlY3V0b3IgPSBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IoKSxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IChjd2Q6IHN0cmluZykgPT4gR2F0ZU1lbW9TdGF0ZSA9IGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICAvLyBUaGUgaGFyZC1kZW55IHN3aXRjaCBpcyBhIHBhcmFtZXRlciAoZGVmYXVsdGluZyB0byB0aGUgc2hpcHBlZCBjb25zdGFudCkgc29cbiAgLy8gdGhlIGRvY3VtZW50ZWQgZmFsbGJhY2sgYnJhbmNoIGlzIGRpcmVjdGx5IGV4ZXJjaXNhYmxlIGluIHRlc3RzIHdpdGhvdXRcbiAgLy8gbXV0YXRpbmcgYSBtb2R1bGUtbGV2ZWwgY29uc3QuIFByb2R1Y3Rpb24gd2lyaW5nIG5ldmVyIHBhc3NlcyB0aGlzIFx1MjAxNCB0aGVcbiAgLy8gZGVmYXVsdCBleHBvcnQgYmVsb3cgY29uc3RydWN0cyB0aGUgaGFuZGxlciB3aXRoIHRoZSBjb25zdGFudCdzIHZhbHVlLlxuICBoYXJkRGVueTogYm9vbGVhbiA9IENPREVYX0dBVEVfSEFSRF9ERU5ZXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIExvZyB0aGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbF9uYW1lIHNvIHRoZSBmaXJzdCBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsXG4gICAgICAvLyBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvICh0aGUgc3Bpa2UgbmV2ZXIgY29uZmlybWVkIGl0IGVtcGlyaWNhbGx5KS5cbiAgICAgIGN0eC5sb2dnZXIuaW5mbygnZ2l0LXNwYW4gZ2F0ZSBvYnNlcnZlZCBzaGVsbCB0b29sJywgeyB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSB9KTtcblxuICAgICAgY29uc3QgY29tbWFuZCA9IGV4dHJhY3RTaGVsbENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSAnbm9uZScpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICAgIGNvbnN0IGFsbCA9IHBhcnNlZC5raW5kID09PSAnY29tbWl0JyA/IGNvbW1pdFN0YWdlc0FsbChjb21tYW5kKSA6IGZhbHNlO1xuICAgICAgY29uc3QgY2hhbmdlc2V0ID0gYXdhaXQgcmVzb2x2ZUNoYW5nZXNldChwYXJzZWQua2luZCwgYWxsLCBjd2QsIGdpdCwgcGFyc2VkLnBhdGhzKTtcblxuICAgICAgY29uc3QgbW9kZSA9IHBhcnNlZC5raW5kID09PSAnc3RhdHVzJyA/ICdpbmZvcm0nIDogJ2VuZm9yY2UnO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXZhbHVhdGVHYXRlKGNoYW5nZXNldCwgY3dkLCBleGVjdXRvcnMsIG1lbW9GYWN0b3J5KGN3ZCksIG1vZGUpO1xuICAgICAgaWYgKHJlc3VsdC5kZWNpc2lvbiAhPT0gJ2RlbnknKSB7XG4gICAgICAgIC8vIEVudmlyb25tZW50YWwgc3RhbGVuZXNzIGFuZCBhIGZhaWxlZCBzdGFsZW5lc3Mgc2NhbiBib3RoIGFsbG93XG4gICAgICAgIC8vIChmYWlsLW9wZW4pIGJ1dCBtdXN0IG5vdCBiZSBzd2FsbG93ZWQ6IGxvZyBhbmQgc3VyZmFjZSB0aGUgcmVhc29uIGFzXG4gICAgICAgIC8vIGFkZGl0aW9uYWwgY29udGV4dC5cbiAgICAgICAgaWYgKHJlc3VsdC5raW5kID09PSAnZW52aXJvbm1lbnRhbCcgfHwgcmVzdWx0LmtpbmQgPT09ICdzY2FuLWZhaWxlZCcpIHtcbiAgICAgICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgYWxsb3dlZCB3aXRoIGFuIHVucmVzb2x2ZWQgY29uZGl0aW9uJywgeyByZWFzb246IHJlc3VsdC5yZWFzb24gfSk7XG4gICAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0LnJlYXNvbiwgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvbiB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBgc3RhdHVzYC1vbmx5IGFkdmlzb3J5IGtpbmRzOiBzcGFuIGRlYnQgZXhpc3RzLCBidXQgYSBzdGF0dXMgY2hlY2tcbiAgICAgICAgLy8gbmV2ZXIgaG9sZHMgdGhlIGNvbW1hbmQgXHUyMDE0IHN1cmZhY2UgaXQgYXMgaW5mb3JtYXRpb24sIG5vdCBhIHdhcm5pbmcuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJyB8fCByZXN1bHQua2luZCA9PT0gJ3VuY292ZXJlZC13cml0ZXMtaW5mbycpIHtcbiAgICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQucmVhc29uLCBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXJkRGVueSkge1xuICAgICAgICAvLyBQcmltYXJ5IHBhdGggKHBlciB0aGUgUkVBRE1FKTogYWN0dWFsbHkgYmxvY2sgdGhlIGNvbW1hbmQuXG4gICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHtcbiAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55JyxcbiAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IHJlc3VsdC5yZWFzb24sXG4gICAgICAgICAgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvblxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIC8vIEZhbGxiYWNrIHBhdGggKENBUkQubWQgY29udGluZ2VuY3kpOiBjYW5ub3QgYmxvY2ssIHNvIHN1cmZhY2UgdGhlIHNhbWVcbiAgICAgIC8vIGNoZWNrbGlzdCBhcyBhIGxvdWQgd2FybmluZyBhbmQgYWxsb3cgXHUyMDE0IHRoZSBDSSByZWNpcGUgZW5mb3JjZXMgZm9yIENvZGV4LlxuICAgICAgY29uc3Qgd2FybmluZyA9IGBDb3VsZCBub3QgYmxvY2sgdGhpcyBjb21tYW5kIFx1MjAxNCB0aGUgaXNzdWUgYmVsb3cgc3RpbGwgbmVlZHMgcmVzb2x2aW5nOlxcbiR7cmVzdWx0LnJlYXNvbn1gO1xuICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogd2FybmluZywgc3lzdGVtTWVzc2FnZTogd2FybmluZyB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGN0eC5sb2dnZXIud2FybignZ2l0LXNwYW4gZ2F0ZSBmYWlsZWQgb3BlbiBvbiBhbiB1bmNhdWdodCBlcnJvcicsIHsgZXJyIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2h8c2hlbGx8ZXhlY3xsb2NhbF9zaGVsbCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL2dhdGUudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxn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QU0sTUFBTSxNQUFNLE9BQU87QUFDekIsWUFBTSxNQUFNLE9BQU8sU0FBUyxXQUFXLGdCQUFnQixPQUFPLElBQUk7QUFDbEUsWUFBTSxZQUFZLE1BQU0saUJBQWlCLE9BQU8sTUFBTSxLQUFLLEtBQUssS0FBSyxPQUFPLEtBQUs7QUFFakYsWUFBTSxPQUFPLE9BQU8sU0FBUyxXQUFXLFdBQVc7QUFDbkQsWUFBTSxTQUFTLE1BQU0sYUFBYSxXQUFXLEtBQUssV0FBVyxZQUFZLEdBQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxhQUFhLFFBQVE7QUFJOUIsWUFBSSxPQUFPLFNBQVMsbUJBQW1CLE9BQU8sU0FBUyxlQUFlO0FBQ3BFLGNBQUksT0FBTyxLQUFLLHNEQUFzRCxFQUFFLFFBQVEsT0FBTyxPQUFPLENBQUM7QUFDL0YsaUJBQU8saUJBQWlCLEVBQUUsbUJBQW1CLE9BQU8sUUFBUSxlQUFlLE9BQU8sT0FBTyxDQUFDO0FBQUEsUUFDNUY7QUFHQSxZQUFJLE9BQU8sU0FBUyw2QkFBNkIsT0FBTyxTQUFTLHlCQUF5QjtBQUN4RixpQkFBTyxpQkFBaUIsRUFBRSxtQkFBbUIsT0FBTyxRQUFRLGVBQWUsT0FBTyxPQUFPLENBQUM7QUFBQSxRQUM1RjtBQUNBLGVBQU87QUFBQSxNQUNUO0FBRUEsVUFBSSxVQUFVO0FBRVosZUFBTyxpQkFBaUI7QUFBQSxVQUN0QixvQkFBb0I7QUFBQSxVQUNwQiwwQkFBMEIsT0FBTztBQUFBLFVBQ2pDLGVBQWUsT0FBTztBQUFBLFFBQ3hCLENBQUM7QUFBQSxNQUNIO0FBR0EsWUFBTSxVQUFVO0FBQUEsRUFBMEUsT0FBTyxNQUFNO0FBQ3ZHLGFBQU8saUJBQWlCLEVBQUUsbUJBQW1CLFNBQVMsZUFBZSxRQUFRLENBQUM7QUFBQSxJQUNoRixTQUFTLEtBQUs7QUFDWixVQUFJLE9BQU8sS0FBSyxrREFBa0QsRUFBRSxJQUFJLENBQUM7QUFDekUsYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLGVBQVEsZUFBZSxFQUFFLFNBQVMsK0JBQStCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDN0kxRyxRQUFRLFlBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImNhbmRpZGF0ZXMiLCAic3RhZ2VkIiwgInRyYWNrZWQiLCAic2VlbiIsICJ1bmNvdmVyZWQiLCAiY2xvc2luZyIsICJib2R5IiwgImV4ZWNGaWxlU3luYyJdCn0K
