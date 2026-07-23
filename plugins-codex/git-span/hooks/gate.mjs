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
function dedupeByAnchor(rows) {
  const order = [];
  const byAddr = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const addr = anchorText(row);
    let statuses = byAddr.get(addr);
    if (!statuses) {
      statuses = /* @__PURE__ */ new Set();
      byAddr.set(addr, statuses);
      order.push(addr);
    }
    statuses.add(row.status);
  }
  return order.map((addr) => ({ addr, statuses: [...byAddr.get(addr) ?? []].sort() }));
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
    for (const { addr, statuses } of dedupeByAnchor(pending)) {
      out.push(`- ${addr} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
    }
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
        const exact = pending.filter((row) => anchorText(row) === addr);
        const matched = exact.length > 0 ? exact : pending.filter((row) => addr === row.path || addr.startsWith(`${row.path}#`));
        if (matched.length > 0) {
          const matchedSet = new Set(matched);
          pending = pending.filter((row) => !matchedSet.has(row));
          const statuses = [...new Set(matched.map((row) => row.status))].sort();
          out.push(`${line} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
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
    for (const { addr, statuses } of dedupeByAnchor(group)) {
      out.push(`- ${addr} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
    }
  }
  return out.join("\n");
}
function renderStalenessReason(findings, blocksText, mode = "enforce", alreadySeen = false) {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `\`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} "..."\``;
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
function wrapGitSpanContext(text) {
  if (text.includes("<git-span>")) return text;
  return `<git-span>
${text}
</git-span>`;
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
    '`git span why <name> "<why>"`',
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
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
        }
        if (result.kind === "semantic-staleness-info" || result.kind === "uncovered-writes-info") {
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
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
      return preToolUseOutput({ additionalContext: wrapGitSpanContext(warning), systemMessage: warning });
    } catch (err) {
      ctx.logger.warn("git-span gate failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
var gate_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/gate-entry.ts
execute(gate_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgdHlwZSBTdGFsZVBvcmNlbGFpblJvdyxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBpc0dhdGVJZ25vcmVkLCBsb2FkR2F0ZUlnbm9yZSB9IGZyb20gJy4vZ2F0ZS1pZ25vcmUuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNjYW4tZmFpbHVyZSBzaWduYWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhaXNlZCBieSB0aGUgYHN0YWxlYCBleGVjdXRvciB3aGVuIGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzXG4gKiBzY29wZWQgc2NhbiBcdTIwMTQgYXMgb3Bwb3NlZCB0byBjb21wbGV0aW5nIGFuZCByZXBvcnRpbmcgZHJpZnQuIGBnaXQgc3BhbiBzdGFsZWBcbiAqIGV4aXRzIG5vbi16ZXJvIGluIHR3byB2ZXJ5IGRpZmZlcmVudCBzaXR1YXRpb25zOiBvbiBsZWdpdGltYXRlIGRyaWZ0IChyZWFsXG4gKiBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQpIGFuZCBvbiBhIGhhcmQgc2NhbiBmYWlsdXJlIChlLmcuIGFuIHVucmVhZGFibGVcbiAqIGFuY2hvciBmaWxlIGFib3J0cyB0aGUgd2hvbGUgc2NvcGVkIHF1ZXJ5LCBsZWF2aW5nIHN0ZG91dCBlbXB0eSBhbmQgYW4gZXJyb3JcbiAqIG9uIHN0ZGVycikuIE9ubHkgdGhlIHNlY29uZCB0aHJvd3MgdGhpcywgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gY2FuIHRlbGwgYVxuICogc2NhbiB0aGF0ICpyYW4gY2xlYW4qIChlbXB0eSByb3dzKSBmcm9tIG9uZSB0aGF0ICpuZXZlciByYW4qIChlbXB0eSByb3dzXG4gKiBiZWNhdXNlIGl0IGFib3J0ZWQpIGFuZCByZWZ1c2UgdG8gcmVhZCB0aGUgbGF0dGVyIGFzIGEgY2xlYW4gcGFzcy4gYGRldGFpbGBcbiAqIGNhcnJpZXMgdGhlIENMSSdzIHN0ZGVyciBmb3IgdGhlIHN1cmZhY2VkIHJlYXNvbi5cbiAqL1xuZXhwb3J0IGNsYXNzIEdhdGVTY2FuRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIHJlYWRvbmx5IGRldGFpbDogc3RyaW5nO1xuICBjb25zdHJ1Y3RvcihkZXRhaWw6IHN0cmluZykge1xuICAgIHN1cGVyKGBnaXQgc3BhbiBzdGFsZSBjb3VsZCBub3QgY29tcGxldGUgaXRzIHNjYW46ICR7ZGV0YWlsfWApO1xuICAgIHRoaXMubmFtZSA9ICdHYXRlU2NhbkVycm9yJztcbiAgICB0aGlzLmRldGFpbCA9IGRldGFpbDtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGtpbmQgb2YgZ2F0ZWQgZ2l0IGNvbW1hbmQgYSBzaGVsbCBjb21tYW5kIHN0cmluZyByZXNvbHZlcyB0by4gYCdub25lJ2BcbiAqIGlzIHRoZSBjb25zZXJ2YXRpdmUgZmFpbC1vcGVuIGFuc3dlcjogYW55IHNoYXBlIHtAbGluayBwYXJzZUdpdENvbW1hbmR9IGRvZXNcbiAqIG5vdCBjb25maWRlbnRseSByZWNvZ25pemUgYXMgYSBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYC9gZ2l0IHN0YXR1c2AgbWFwcyB0b1xuICogYCdub25lJ2AgYW5kIHRoZSBnYXRlIGFsbG93cyB0aGUgY29tbWFuZCB0aHJvdWdoIHVudG91Y2hlZC4gYCdzdGF0dXMnYCBpc1xuICogbmV2ZXIgZGVuaWVkIFx1MjAxNCB7QGxpbmsgZXZhbHVhdGVHYXRlfSdzIGAnaW5mb3JtJ2AgbW9kZSBvbmx5IGV2ZXIgYWxsb3dzLFxuICogc3VyZmFjaW5nIGFueSBzcGFuIGRlYnQgYXMgYWR2aXNvcnkgY29udGV4dC5cbiAqL1xuZXhwb3J0IHR5cGUgR2l0Q29tbWFuZEtpbmQgPSAnY29tbWl0JyB8ICdwdXNoJyB8ICdzdGF0dXMnIHwgJ25vbmUnO1xuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgcGFyc2luZyBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZvciBhIGdhdGVkIGdpdCBpbnZvY2F0aW9uLlxuICpcbiAqIGBwYXRoc2AgY2FycmllcyBvbmx5IHdoYXQgaXMgcGFyc2VhYmxlIGZyb20gdGhlIGNvbW1hbmQgbGluZSBpdHNlbGYgXHUyMDE0IHRoZVxuICogZXhwbGljaXQgcGF0aHNwZWNzIGEgYGdpdCBjb21taXQgLS0gPHBhdGg+XHUyMDI2YCBmb3JtIG5hbWVzLiBJdCBpcyBkZWxpYmVyYXRlbHlcbiAqICpub3QqIHRoZSBjaGFuZ2VzZXQ6IHRoZSBmdWxsZXIgcmVzb2x1dGlvbiAoc3RhZ2VkIGZpbGVzLCB0aGUgYC1hYC9gLWFtYFxuICogZXhwYW5zaW9uIGFnYWluc3QgdHJhY2tlZC1tb2RpZmllZCBmaWxlcywgdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UpIGlzXG4gKiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0ncyBqb2IsIGRyaXZlbiBmcm9tIHRoZSByZXBvIHN0YXRlLCBub3QgZnJvbSB0aGVcbiAqIGNvbW1hbmQgdGV4dC4gYHBhdGhzYCBpcyBvbWl0dGVkIHdoZW4gdGhlIGNvbW1hbmQgbmFtZXMgbm8gZXhwbGljaXRcbiAqIHBhdGhzcGVjLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEdpdENvbW1hbmQge1xuICBraW5kOiBHaXRDb21tYW5kS2luZDtcbiAgcGF0aHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBXb3JkLWJvdW5kYXJ5IHBhcnNlIG9mIGEgYGdpdCBjb21taXRgIC8gYGdpdCBwdXNoYCAvIGBnaXQgc3RhdHVzYCBpbnZvY2F0aW9uXG4gKiBlbWJlZGRlZCBpbiBhbiBhcmJpdHJhcnkgc2hlbGwgY29tbWFuZCBzdHJpbmcuXG4gKlxuICogTXVzdCByZWNvZ25pemUgdGhlIHJlYWwgc2hhcGVzIGNvbW1pdHMsIHB1c2hlcywgYW5kIHN0YXR1cyBjaGVja3MgYXJyaXZlIGluOlxuICogY2hhaW5lZCBjb21tYW5kcyAoYFx1MjAyNiAmJiBnaXQgY29tbWl0IFx1MjAyNmAsIGBcdTIwMjY7IGdpdCBwdXNoYCwgYFx1MjAyNiB8IFx1MjAyNmApLCBhbiBleHBsaWNpdFxuICogcmVwbyB2aWEgYGdpdCAtQyA8ZGlyPiBjb21taXQgXHUyMDI2YCwgdHJhaWxpbmcgcGF0aHNwZWNzIGFmdGVyIGAtLWAsIHRoZVxuICogYC1hYC9gLWFtYCBcImNvbW1pdCBhbGwgdHJhY2tlZC1tb2RpZmllZFwiIGZvcm1zLCBhbmQgaW52b2NhdGlvbiBmcm9tIGEgY3dkXG4gKiBiZWxvdyB0aGUgcmVwbyByb290LiBNYXRjaGluZyBpcyBvbiB3b3JkIGJvdW5kYXJpZXMsIG5ldmVyIHN1YnN0cmluZzogYSBwYXRoXG4gKiBvciBtZXNzYWdlIHRoYXQgbWVyZWx5IGNvbnRhaW5zIHRoZSB0ZXh0IGBnaXQgY29tbWl0YCBtdXN0IG5vdCB0cmlwIHRoZVxuICogZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgL2BnaXQgc3RhdHVzYCBcdTIwMTQgYW4gdW5mYW1pbGlhciBzdWJjb21tYW5kLCBhbiBhbGlhcywgYW5cbiAqIG9iZnVzY2F0ZWQgb3IgZHluYW1pY2FsbHktYnVpbHQgaW52b2NhdGlvbiBcdTIwMTQgcmV0dXJucyBgeyBraW5kOiAnbm9uZScgfWAgc28gdGhlXG4gKiBnYXRlIGFsbG93cyBpdCByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGEgc2hha3kgcmVhZC4gKFNlZSBDQVJELm1kIFwiUmlza3MgYW5kXG4gKiByZXF1aXJlZCBzcGlrZXMgXHUyMTkyIENvbW1hbmQgcGFyc2luZ1wiIGFuZCBkZXNpZ24tZGVjaXNpb25zLm1kICMxLilcbiAqXG4gKiBAcGFyYW0gY29tbWFuZCBUaGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZyb20gdGhlIGhvb2sncyB0b29sIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IFBhcnNlZEdpdENvbW1hbmQge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYpIGNvbnRpbnVlO1xuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ2NvbW1pdCcpIHtcbiAgICAgIGNvbnN0IGRhc2hEYXNoID0gaW52LmFyZ3MuaW5kZXhPZignLS0nKTtcbiAgICAgIGNvbnN0IHBhdGhzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKGRhc2hEYXNoICsgMSkuZmlsdGVyKChwKSA9PiBwLmxlbmd0aCA+IDApIDogW107XG4gICAgICByZXR1cm4gcGF0aHMubGVuZ3RoID4gMCA/IHsga2luZDogJ2NvbW1pdCcsIHBhdGhzIH0gOiB7IGtpbmQ6ICdjb21taXQnIH07XG4gICAgfVxuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ3B1c2gnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAncHVzaCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnc3RhdHVzJykge1xuICAgICAgcmV0dXJuIHsga2luZDogJ3N0YXR1cycgfTtcbiAgICB9XG4gICAgLy8gQSByZWNvZ25pemVkIGBnaXRgIGludm9jYXRpb24gdGhhdCBpcyBuZWl0aGVyIGNvbW1pdCwgcHVzaCwgbm9yIHN0YXR1c1xuICAgIC8vIChlLmcuIGBnaXQgYWRkIC4gJiYgZ2l0IGNvbW1pdCBcdTIwMjZgKToga2VlcCBzY2FubmluZyBsYXRlciBzZWdtZW50cy5cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBjb21taXRgIGluIHRoZSBjb21tYW5kIGlzIGFuIGAtYWAvYC1hbWAvYC0tYWxsYCBmb3JtIFx1MjAxNCB0aGVcbiAqIFwic3RhZ2UgYWxsIHRyYWNrZWQtbW9kaWZpZWQgZmlsZXNcIiB2YXJpYW50IHdob3NlIGNoYW5nZXNldCB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIG11c3Qgd2lkZW4gYmV5b25kIHRoZSBhbHJlYWR5LXN0YWdlZCBzZXQuXG4gKlxuICogVGhlIGBhbGxgIHNpZ25hbCBpcyBkZWxpYmVyYXRlbHkgKm5vdCogY2FycmllZCBvbiB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIChzZWUgdGhhdCB0eXBlJ3MgZG9jKTogdGhlIGFkYXB0ZXIgZGVyaXZlcyBpdCBoZXJlIGZyb20gdGhlIHNhbWUgY29tbWFuZCB0ZXh0XG4gKiBhbmQgdGhyZWFkcyBpdCBpbnRvIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBleHBsaWNpdGx5LiBDb25zZXJ2YXRpdmU6IG9ubHkgYVxuICogc2hvcnQtZmxhZyBncm91cCBjb250YWluaW5nIGBhYCAoYC1hYCwgYC1hbWAsIGAtbWFgKSBvciBhbiBleHBsaWNpdCBgLS1hbGxgLFxuICogc2Nhbm5lZCBiZWZvcmUgYW55IGAtLWAgcGF0aHNwZWMgc2VwYXJhdG9yLCBjb3VudHMuXG4gKlxuICogVmFsdWUtdGFraW5nIGNvbW1pdCBvcHRpb25zIChgLW1gLCBgLS1tZXNzYWdlYCwgYC1GYCwgYC1DYCwgXHUyMDI2KSBjb25zdW1lIHRoZWlyXG4gKiBmb2xsb3dpbmcgdG9rZW4sIHNvIGl0IGlzIG5ldmVyIHNjYW5uZWQgYXMgYSBmbGFnOiBhIG1lc3NhZ2Ugd29yZCBsaWtlXG4gKiBgLWFuYWx5c2lzYCBpbiBgZ2l0IGNvbW1pdCAtbSBcIi1hbmFseXNpc1wiYCBtdXN0IG5vdCBiZSBtaXNyZWFkIGFzIHRoZVxuICogYC0tYWxsYC1lcXVpdmFsZW50IHNob3J0LWZsYWcgY2x1c3RlciBhbmQgd2lkZW4gdGhlIGNoYW5nZXNldC5cbiAqL1xuY29uc3QgQ09NTUlUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1tJyxcbiAgJy0tbWVzc2FnZScsXG4gICctRicsXG4gICctLWZpbGUnLFxuICAnLUMnLFxuICAnLS1yZXVzZS1tZXNzYWdlJyxcbiAgJy1jJyxcbiAgJy0tcmVlZGl0LW1lc3NhZ2UnLFxuICAnLS1hdXRob3InLFxuICAnLS1kYXRlJyxcbiAgJy10JyxcbiAgJy0tdGVtcGxhdGUnLFxuICAnLS1maXh1cCcsXG4gICctLXNxdWFzaCcsXG4gICctLXRyYWlsZXInLFxuICAnLS1jbGVhbnVwJyxcbiAgJy0tZ3BnLXNpZ24nXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbW1pdFN0YWdlc0FsbChjb21tYW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNwbGl0U2VnbWVudHMoY29tbWFuZCkpIHtcbiAgICBjb25zdCBpbnYgPSBtYXRjaEdpdEludm9jYXRpb24odG9rZW5pemUoc2VnbWVudCkpO1xuICAgIGlmICghaW52IHx8IGludi5zdWJjb21tYW5kICE9PSAnY29tbWl0JykgY29udGludWU7XG4gICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgIGNvbnN0IGZsYWdBcmdzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKDAsIGRhc2hEYXNoKSA6IGludi5hcmdzO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmxhZ0FyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGFyZyA9IGZsYWdBcmdzW2ldO1xuICAgICAgaWYgKGFyZyA9PT0gJy0tYWxsJykgcmV0dXJuIHRydWU7XG4gICAgICAvLyBBIHZhbHVlLXRha2luZyBvcHRpb24gY29uc3VtZXMgaXRzIGZvbGxvd2luZyB0b2tlbiBcdTIwMTQgc2tpcCB0aGF0IHRva2VuIHNvXG4gICAgICAvLyBhIG1lc3NhZ2UvYXV0aG9yL2RhdGUgYXJndW1lbnQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhbiBgLWFgIGNsdXN0ZXIuXG4gICAgICBpZiAoQ09NTUlUX1ZBTFVFX09QVElPTlMuaGFzKGFyZykpIHtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghYXJnLnN0YXJ0c1dpdGgoJy0tJykgJiYgL14tW0EtWmEtel0qYVtBLVphLXpdKiQvLnRlc3QoYXJnKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIFNoZWxsIGNvbnRyb2wgb3BlcmF0b3JzIHRoYXQgc2VwYXJhdGUgb25lIHNpbXBsZSBjb21tYW5kIGZyb20gdGhlIG5leHQuXG4vLyBTcGxpdHRpbmcgb24gdGhlc2UgKG91dHNpZGUgcXVvdGVzKSBpc29sYXRlcyBlYWNoIGNvbW1hbmQgc28gYSBgZ2l0IGNvbW1pdGAvXG4vLyBgZ2l0IHB1c2hgIGNoYWluZWQgYWZ0ZXIgYCYmYC9gO2AvYHxgIGlzIGZvdW5kLCB3aGlsZSB0ZXh0IGluc2lkZSBhIHF1b3RlZFxuLy8gYXJndW1lbnQgKGBlY2hvIFwiZ2l0IGNvbW1pdFwiYCkgc3RheXMgd2l0aGluIGl0cyBvd24gbm9uLWdpdCBzZWdtZW50LlxuY29uc3QgVFdPX0NIQVJfT1BFUkFUT1JTID0gbmV3IFNldChbJyYmJywgJ3x8J10pO1xuY29uc3QgT05FX0NIQVJfU0VQQVJBVE9SUyA9IG5ldyBTZXQoWyc7JywgJ3wnLCAnXFxuJywgJyYnLCAnKCcsICcpJ10pO1xuXG4vKiogU3BsaXQgYSBzaGVsbCBjb21tYW5kIGludG8gc2ltcGxlLWNvbW1hbmQgc2VnbWVudHMsIHJlc3BlY3RpbmcgcXVvdGVzLiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9ICcnO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbW1hbmQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IGNvbW1hbmRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChUV09fQ0hBUl9PUEVSQVRPUlMuaGFzKGNvbW1hbmQuc2xpY2UoaSwgaSArIDIpKSkge1xuICAgICAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoT05FX0NIQVJfU0VQQVJBVE9SUy5oYXMoY2gpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1cnJlbnQgKz0gY2g7XG4gIH1cbiAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG4vKipcbiAqIFRva2VuaXplIG9uZSBzZWdtZW50IGludG8gc2hlbGwgd29yZHMsIHJlc3BlY3Rpbmcgc2luZ2xlL2RvdWJsZSBxdW90ZXMgYW5kXG4gKiBzdHJpcHBpbmcgdGhlIHF1b3RlIGNoYXJhY3RlcnMuIERlbGliZXJhdGVseSBtaW5pbWFsIChubyBleHBhbnNpb24sIG5vXG4gKiBlc2NhcGUgaGFuZGxpbmcgYmV5b25kIHF1b3Rlcyk6IHRoZSBnb2FsIGlzIGNvbmZpZGVudCByZWNvZ25pdGlvbiBvZiBhXG4gKiBgZ2l0IGNvbW1pdGAvYHB1c2hgIHNoYXBlLCBub3QgYSBmdWxsIHNoZWxsIHBhcnNlci5cbiAqL1xuZnVuY3Rpb24gdG9rZW5pemUoc2VnbWVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCB0b2tlbnM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBoYXMgPSBmYWxzZTtcbiAgbGV0IHF1b3RlOiAnXCInIHwgXCInXCIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBzZWdtZW50W2ldO1xuICAgIGlmIChxdW90ZSkge1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgZWxzZSBjdXJyZW50ICs9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcIicgfHwgY2ggPT09IFwiJ1wiKSB7XG4gICAgICBxdW90ZSA9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICcgJyB8fCBjaCA9PT0gJ1xcdCcpIHtcbiAgICAgIGlmIChoYXMpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgICAgaGFzID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgICBoYXMgPSB0cnVlO1xuICB9XG4gIGlmIChoYXMpIHRva2Vucy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKiogR2l0IGdsb2JhbCBvcHRpb25zIHRoYXQgY29uc3VtZSBhIHNlcGFyYXRlIGZvbGxvd2luZyB2YWx1ZSB0b2tlbi4gKi9cbmNvbnN0IEdJVF9WQUxVRV9PUFRJT05TID0gbmV3IFNldChbXG4gICctQycsXG4gICctYycsXG4gICctLWdpdC1kaXInLFxuICAnLS13b3JrLXRyZWUnLFxuICAnLS1uYW1lc3BhY2UnLFxuICAnLS1zdXBlci1wcmVmaXgnLFxuICAnLS1leGVjLXBhdGgnLFxuICAnLS1hdHRyLXNvdXJjZScsXG4gICctLWNvbmZpZy1lbnYnXG5dKTtcblxuaW50ZXJmYWNlIEdpdEludm9jYXRpb24ge1xuICBzdWJjb21tYW5kOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIElmIGEgc2VnbWVudCdzIHRva2VucyBhcmUgYSBgZ2l0IDxzdWJjb21tYW5kPiBcdTIwMjZgIGludm9jYXRpb24sIHJldHVybiB0aGVcbiAqIHN1YmNvbW1hbmQgYW5kIGl0cyByZW1haW5pbmcgYXJnczsgb3RoZXJ3aXNlIGBudWxsYC4gTGVhZGluZyBgVkFSPXZhbHVlYFxuICogZW52aXJvbm1lbnQgYXNzaWdubWVudHMgYW5kIGBnaXRgIGdsb2JhbCBvcHRpb25zIChpbmNsdWRpbmcgdGhlIHZhbHVlLXRha2luZ1xuICogb25lcykgYXJlIHNraXBwZWQgc28gdGhlIHN1YmNvbW1hbmQgaXMgY29ycmVjdGx5IGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbnM6IHN0cmluZ1tdKTogR2l0SW52b2NhdGlvbiB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCAmJiAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9Ly50ZXN0KHRva2Vuc1tpXSkpIGkrKztcbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCB8fCB0b2tlbnNbaV0gIT09ICdnaXQnKSByZXR1cm4gbnVsbDtcbiAgaSsrO1xuICB3aGlsZSAoaSA8IHRva2Vucy5sZW5ndGgpIHtcbiAgICBjb25zdCB0ID0gdG9rZW5zW2ldO1xuICAgIGlmICh0ID09PSAnLS0nKSByZXR1cm4gbnVsbDsgLy8gYSBgLS1gIGJlZm9yZSBhbnkgc3ViY29tbWFuZCBpcyBub3QgYSBzaGFwZSB3ZSByZWNvZ25pemVcbiAgICBpZiAoIXQuc3RhcnRzV2l0aCgnLScpKSBicmVhaztcbiAgICBpICs9IEdJVF9WQUxVRV9PUFRJT05TLmhhcyh0KSA/IDIgOiAxO1xuICB9XG4gIGlmIChpID49IHRva2Vucy5sZW5ndGgpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBzdWJjb21tYW5kOiB0b2tlbnNbaV0sIGFyZ3M6IHRva2Vucy5zbGljZShpICsgMSkgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDaGFuZ2VzZXQgcmVzb2x1dGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGdpdCBzdXJmYWNlIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBuZWVkcyB0byB0dXJuIGEgcGFyc2VkXG4gKiBjb21tYW5kIGludG8gdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcGF0aHMgdGhhdCB3b3VsZCBsYW5kLiBLZXB0IGFzIG5hcnJvdyBhc3luY1xuICogZnVuY3Rpb25zIChyYXRoZXIgdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgZm9sbG93aW5nIGB0b3VjaC1jb3JlLnRzYCdzXG4gKiBgVG91Y2hFeGVjdXRvcnNgIHBhdHRlcm4sIHNvIFBoYXNlIDMuMidzIHRlc3RzIGZha2UgdGhlIHJlcG8gc3RhdGUgd2l0aG91dCBhXG4gKiByZWFsIHN1YnByb2Nlc3MgYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBvbmUgaXRzZWxmLlxuICpcbiAqIEFsbCByZXR1cm5lZCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHaXRFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBQYXRocyBzdGFnZWQgZm9yIHRoZSBuZXh0IGNvbW1pdCBcdTIwMTQgYGdpdCBkaWZmIC0tY2FjaGVkIC0tbmFtZS1vbmx5YC4gVGhlc2VcbiAgICogYXJlIHdoYXQgYSBwbGFpbiBgZ2l0IGNvbW1pdGAgd291bGQgbGFuZC5cbiAgICovXG4gIHN0YWdlZFBhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBUcmFja2VkIGZpbGVzIHdpdGggdW5zdGFnZWQgd29ya2luZy10cmVlIG1vZGlmaWNhdGlvbnMgXHUyMDE0XG4gICAqIGBnaXQgZGlmZiAtLW5hbWUtb25seWAuIEZvbGRlZCBpbnRvIHRoZSBjaGFuZ2VzZXQgb25seSBmb3IgYC1hYC9gLWFtYFxuICAgKiBmb3Jtcywgd2hpY2ggc3RhZ2UgdHJhY2tlZC1tb2RpZmllZCBmaWxlcyBpbXBsaWNpdGx5IGF0IGNvbW1pdCB0aW1lLlxuICAgKi9cbiAgdHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFBhdGhzIGluIHRoZSBvdXRnb2luZyBwdXNoIHJhbmdlIFx1MjAxNCB0aGUgZmlsZXMgY2hhbmdlZCBieSBgQHt1fS4uSEVBRGAsIHdpdGhcbiAgICogYSBtZXJnZS1iYXNlLWFnYWluc3QtdGhlLWRlZmF1bHQtcmVtb3RlLWJyYW5jaCBmYWxsYmFjayB3aGVuIG5vIHVwc3RyZWFtIGlzXG4gICAqIGNvbmZpZ3VyZWQuIFRoZXNlIGFyZSB3aGF0IGEgYGdpdCBwdXNoYCB3b3VsZCBwdWJsaXNoLlxuICAgKi9cbiAgb3V0Z29pbmdQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgdW5kZXIgdGhlIGdpdmVuIGV4cGxpY2l0IHBhdGhzcGVjcyB3aG9zZSB3b3JraW5nLXRyZWUgY29udGVudCBkaWZmZXJzXG4gICAqIGZyb20gYEhFQURgIFx1MjAxNCBgZ2l0IGRpZmYgSEVBRCAtLW5hbWUtb25seSAtLSA8cGF0aHNwZWNzPmAuIFRoaXMgaXMgd2hhdCBhXG4gICAqIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgKGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgKSBhY3R1YWxseSBsYW5kczogdGhlXG4gICAqIGN1cnJlbnQgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2UgcGF0aHNwZWNzLCByZWdhcmRsZXNzIG9mIHdoYXQgZWxzZSBpc1xuICAgKiBzdGFnZWQuIFVzZWQgdG8gc2NvcGUgdGhlIGNoYW5nZXNldCB3aGVuIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSBpc1xuICAgKiBwcmVzZW50LCBzbyB0aGUgZ2F0ZSBldmFsdWF0ZXMgZXhhY3RseSB0aGUgZmlsZXMgdGhpcyBjb21taXQgdGFrZXMgXHUyMDE0IG5ldmVyXG4gICAqIGFuIHVucmVsYXRlZCBzdGFnZWQgZmlsZSwgYW5kIG5ldmVyIG1pc3NpbmcgYSBtb2RpZmllZC1idXQtdW5zdGFnZWQgZmlsZVxuICAgKiBuYW1lZCBpbiB0aGUgcGF0aHNwZWMgKHdoaWNoIGBnaXQgZGlmZiAtLWNhY2hlZGAgd291bGQgbmV2ZXIgc3VyZmFjZSkuXG4gICAqL1xuICBwYXRoc3BlY1BhdGhzKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBjb25jcmV0ZSBsaXN0IG9mIHJlcG8tcmVsYXRpdmUgcGF0aHMgYSBnYXRlZCBjb21tYW5kIHdvdWxkIGxhbmQsXG4gKiBzbyB0aGUgZ2F0ZSBjYW4gc2NvcGUgaXRzIHN0YWxlbmVzcy9jb3ZlcmFnZSBjaGVjayB0byBleGFjdGx5IHRoYXQgY2hhbmdlc2V0LlxuICpcbiAqIC0gYGNvbW1pdGAgd2l0aCBleHBsaWNpdCBgcGF0aHNgIChhIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgIGZvcm0pOiBvbmx5XG4gKiAgIHRoZSB3b3JraW5nLXRyZWUgY29udGVudCB1bmRlciB0aG9zZSBwYXRoc3BlY3MgKGBwYXRoc3BlY1BhdGhzYCksIHNpbmNlIGFcbiAqICAgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBleGFjdGx5IHRoYXQsIHJlZ2FyZGxlc3Mgb2YgdGhlIHJlc3Qgb2YgdGhlXG4gKiAgIHN0YWdlZCBzZXQuIGBhbGxgIGlzIGlnbm9yZWQgXHUyMDE0IGAtYWAgYW5kIGFuIGV4cGxpY2l0IHBhdGhzcGVjIGRvIG5vdCBjb21iaW5lLlxuICogLSBgY29tbWl0YCwgbm8gYHBhdGhzYDogdGhlIHN0YWdlZCBwYXRocywgcGx1cyBcdTIwMTQgd2hlbiBgYWxsYCBpcyB0cnVlICh0aGVcbiAqICAgY29tbWFuZCB3YXMgYW4gYC1hYC9gLWFtYCBmb3JtKSBcdTIwMTQgdGhlIHRyYWNrZWQtbW9kaWZpZWQgcGF0aHMgdGhvc2UgZm9ybXNcbiAqICAgc3RhZ2UgaW1wbGljaXRseS5cbiAqIC0gYHB1c2hgOiB0aGUgb3V0Z29pbmcgcmFuZ2UgYEB7dX0uLkhFQURgLCB3aXRoIGEgbWVyZ2UtYmFzZSBmYWxsYmFjayB3aGVuIG5vXG4gKiAgIHVwc3RyZWFtIGlzIGNvbmZpZ3VyZWQuIGBhbGxgL2BwYXRoc2AgYXJlIG5vdCBtZWFuaW5nZnVsIGZvciBhIHB1c2ggYW5kIGFyZVxuICogICBpZ25vcmVkLlxuICogLSBgc3RhdHVzYDogdGhlIHN0YWdlZCBwYXRocyBwbHVzIHRoZSB0cmFja2VkLW1vZGlmaWVkIHBhdGhzLCBkZWR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIHRoZSBzYW1lIHdvcmtpbmctdHJlZSBwaWN0dXJlIGBnaXQgc3RhdHVzYCBpdHNlbGYgcHJpbnRzLCBwcmV2aWV3ZWQgZm9yXG4gKiAgIHNwYW4gZGVidC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgc3RhdHVzIGNoZWNrIGFuZCBhcmVcbiAqICAgaWdub3JlZC5cbiAqXG4gKiBUaGUgYGFsbGAgZmxhZyBhbmQgYHBhdGhzYCBhcmUgdGhyZWFkZWQgaW4gZXhwbGljaXRseSAocmF0aGVyIHRoYW4gcmVhZCBiYWNrXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQpIGJlY2F1c2UgdGhlIGNhbGxlci9hZGFwdGVyIGRlcml2ZXMgdGhlbSBmcm9tIHRoZSBwYXJzZTpcbiAqIGBwYXRoc2AgaXMge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9LCBhbmQgYGFsbGAgKHdoaWNoIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogaW50ZW50aW9uYWxseSBkb2VzIG5vdCBjYXJyeSkgY29tZXMgZnJvbSB7QGxpbmsgY29tbWl0U3RhZ2VzQWxsfS5cbiAqXG4gKiBAcGFyYW0ga2luZCBXaGV0aGVyIHRoZSBjaGFuZ2VzZXQgaXMgYSBjb21taXQncyBzdGFnZWQgc2V0LCBhIHB1c2gncyByYW5nZSwgb3IgYSBzdGF0dXMgcHJldmlldy5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYC9gc3RhdHVzYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcgfCAnc3RhdHVzJyxcbiAgYWxsOiBib29sZWFuLFxuICBjd2Q6IHN0cmluZyxcbiAgZ2l0OiBHaXRFeGVjdXRvcixcbiAgcGF0aHM/OiBzdHJpbmdbXVxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBpZiAoa2luZCA9PT0gJ3B1c2gnKSB7XG4gICAgcmV0dXJuIGdpdC5vdXRnb2luZ1BhdGhzKGN3ZCk7XG4gIH1cbiAgaWYgKGtpbmQgPT09ICdzdGF0dXMnKSB7XG4gICAgY29uc3QgW3N0YWdlZCwgdHJhY2tlZF0gPSBhd2FpdCBQcm9taXNlLmFsbChbZ2l0LnN0YWdlZFBhdGhzKGN3ZCksIGdpdC50cmFja2VkTW9kaWZpZWRQYXRocyhjd2QpXSk7XG4gICAgcmV0dXJuIG1lcmdlVW5pcXVlUGF0aHMoc3RhZ2VkLCB0cmFja2VkKTtcbiAgfVxuICAvLyBBIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgbGFuZHMgb25seSB0aGUgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2VcbiAgLy8gcGF0aHNwZWNzIFx1MjAxNCBzY29wZSB0aGUgY2hhbmdlc2V0IHRvIGV4YWN0bHkgdGhhdCwgbmV2ZXIgdGhlIGZ1bGwgc3RhZ2VkIHNldC5cbiAgaWYgKHBhdGhzICYmIHBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gZ2l0LnBhdGhzcGVjUGF0aHMocGF0aHMsIGN3ZCk7XG4gIH1cbiAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgZ2l0LnN0YWdlZFBhdGhzKGN3ZCk7XG4gIGlmICghYWxsKSByZXR1cm4gc3RhZ2VkO1xuICBjb25zdCB0cmFja2VkID0gYXdhaXQgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCk7XG4gIHJldHVybiBtZXJnZVVuaXF1ZVBhdGhzKHN0YWdlZCwgdHJhY2tlZCk7XG59XG5cbi8qKiBDb25jYXRlbmF0ZSBwYXRoIGxpc3RzIGluIG9yZGVyLCBkcm9wcGluZyBsYXRlciBkdXBsaWNhdGVzIG9mIGFuIGVhcmxpZXIgcGF0aC4gKi9cbmZ1bmN0aW9uIG1lcmdlVW5pcXVlUGF0aHMoLi4uZ3JvdXBzOiBzdHJpbmdbXVtdKTogc3RyaW5nW10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG1lcmdlZDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgZ3JvdXApIHtcbiAgICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChwYXRoKTtcbiAgICAgIG1lcmdlZC5wdXNoKHBhdGgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdhdGUgZXZhbHVhdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlIGdhdGUgZXZhbHVhdGlvbiBuZWVkcyBcdTIwMTQgdGhlIGBmaXhgL2BzdGFsZWAvXG4gKiBgbGlzdGAgYXN5bmMgZnVuY3Rpb25zLCBtaXJyb3JpbmcgYHRvdWNoLWNvcmUudHNgJ3MgYFRvdWNoRXhlY3V0b3JzYC4gVGVzdHNcbiAqIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhOyB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzXG4gKiBpdHNlbGYuIEFsbCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlRXhlY3V0b3JzIHtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgPHBhdGhzPiAtLWZpeGAgXHUyMDE0IHRoZSBiZWx0LWFuZC1icmFjZXMgaGVhbCB0aGF0XG4gICAqIHJ1bnMgYmVmb3JlIGNsYXNzaWZpY2F0aW9uIChwZXIgQ0FSRC5tZCksIHJlLWFuY2hvcmluZyBhbnkgcG9zaXRpb25hbCBkcmlmdFxuICAgKiBpbiB0aGUgY2hhbmdlc2V0IHRoYXQgdGhlIHRvdWNoIGhvb2sgaGFzIG5vdCBhbHJlYWR5IGhlYWxlZC4gUmVwb3J0cyBub3RoaW5nO1xuICAgKiBpdHMgZWZmZWN0IGlzIG9uIHRoZSB3b3JraW5nIHRyZWUsIGFuZCB0aGUgc3Vic2VxdWVudCB7QGxpbmsgR2F0ZUV4ZWN1dG9ycy5zdGFsZX1cbiAgICogcmVhZCBvYnNlcnZlcyB0aGUgaGVhbGVkIHN0YXRlLlxuICAgKi9cbiAgZml4KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiBpdHNcbiAgICogcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IgYW1vbmcgdGhlIGNoYW5nZXNldCdzIHNwYW5zLCBlbXB0eSB3aGVuXG4gICAqIGNsZWFuLiBEZWJ0IGlzIGNsYXNzaWZpZWQgZnJvbSB0aGVzZSByb3dzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsXG4gICAqIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGRlbnkuXG4gICAqXG4gICAqIEFuIGVtcHR5IHJlc3VsdCBtdXN0IG1lYW4gdGhlIHNjYW4gKnJhbiBhbmQgZm91bmQgbm90aGluZyosIG5ldmVyIHRoYXQgdGhlXG4gICAqIHNjYW4gKmNvdWxkIG5vdCBydW4qLiBXaGVuIHRoZSBzY29wZWQgcXVlcnkgYWJvcnRzIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAqIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB0aGUgaW1wbGVtZW50YXRpb24gdGhyb3dzIHtAbGluayBHYXRlU2NhbkVycm9yfVxuICAgKiByYXRoZXIgdGhhbiByZXR1cm5pbmcgYFtdYCwgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gZG9lcyBub3QgbWlzdGFrZSBhblxuICAgKiBhYm9ydGVkIHNjYW4gZm9yIGEgY2xlYW4gb25lIGFuZCBzaWxlbnRseSBhbGxvdyB1bnZlcmlmaWVkIGRlYnQgdGhyb3VnaC5cbiAgICovXG4gIHN0YWxlKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFN0YWxlUG9yY2VsYWluUm93W10+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gdGhlIGNvdmVyaW5nXG4gICAqIGFuY2hvcnMuIFVzZWQgdG8gY29tcHV0ZSAqdW5jb3ZlcmVkIHdyaXRlcyo6IGEgY2hhbmdlZCBwYXRoIHdpdGggemVyb1xuICAgKiBjb3ZlcmluZyByb3dzIGhlcmUgKG1pbnVzIGAuc3Bhbi8qKmAsIGdpdGlnbm9yZWQgcGF0aHMsIGFuZFxuICAgKiBgLnNwYW4vLmdhdGVpZ25vcmVgLWV4Y2x1ZGVkIHBhdGhzIFx1MjAxNCBzZWUge0BsaW5rIGZpbGU6Ly8uL2dhdGUtaWdub3JlLnRzfSlcbiAgICogaXMgYW4gdW5jb3ZlcmVkIHdyaXRlLlxuICAgKi9cbiAgbGlzdChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG4gIC8qKlxuICAgKiBSdW4gYGdpdCBzcGFuIGxpc3QgPG5hbWVzLi4uPmAgKGh1bWFuIGZvcm1hdCkgYW5kIHJldHVybiBpdHMgcmF3IHN0ZG91dCBcdTIwMTRcbiAgICogb25lIGAjIyA8bmFtZT5gIGJsb2NrIHBlciBzcGFuIChhbmNob3IgYnVsbGV0cyArIGRlc2NyaXB0aW9uKSwgYmxvY2tzXG4gICAqIHNlcGFyYXRlZCBieSBgLS0tYC4gVGhlIGRlbnkvYWR2aXNvcnkgcmVuZGVyZXJzIGFubm90YXRlIHRoZXNlIGJsb2NrcyB3aXRoXG4gICAqIHBlci1hbmNob3IgZHJpZnQgbGFiZWxzIHNvIHRoZSBzdXJmYWNlZCBtZXNzYWdlIGNhcnJpZXMgdGhlIGZ1bGwgc3BhblxuICAgKiAoYWxsIGxvY2F0aW9ucyArIGRlc2NyaXB0aW9uKSwgbm90IGp1c3QgdGhlIGRyaWZ0ZWQgcm93cy4gUmV0dXJucyBgJydgIG9uXG4gICAqIGFueSBmYWlsdXJlOyB7QGxpbmsgYW5ub3RhdGVCbG9ja3N9IHRoZW4gc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MgZnJvbVxuICAgKiB0aGUgZmluZGluZ3MgdGhlbXNlbHZlcyBzbyBubyBmaW5kaW5nIGlzIGRyb3BwZWQuXG4gICAqL1xuICBsaXN0QmxvY2tzKG5hbWVzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IG1lbW8gXHUyMDE0IFwiaGF2ZSBJIGFscmVhZHkgcHJlc2VudGVkIHRoaXMgZXhhY3QgZGVidFxuICogc3RhdGUgb25jZT9cIiBUaGUgcGVyc2lzdGVkIHVuaXQgaXMgYSBkaWdlc3Qgb2YgdGhlIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3NcbiAqIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkncyBcImdhdGUgb25jZSBwZXJcbiAqIGRpc3RpbmN0IGRlYnQtc3RhdGVcIik7IHRoZSBkaXNrLWJhY2tlZCBpbXBsZW1lbnRhdGlvbiBzdG9yZXMgb25lIG1hcmtlciBwZXJcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCB3aGVyZVxuICogcHJlc2VuY2UgbWVhbnMgXCJhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiIEluamVjdGVkIGFzIGEgc3RvcmUgYWJzdHJhY3Rpb25cbiAqIChsaWtlIHNwYW4tc3VyZmFjZS50cydzIGBNZW1vU3RvcmVgKSBzbyBQaGFzZSAzLjIgZmFrZXMgaXQgaW4gbWVtb3J5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVNZW1vU3RhdGUge1xuICAvKiogV2hldGhlciB0aGlzIGV4YWN0IGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gcHJlc2VudGVkIG9uY2UuICovXG4gIGhhcyhkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBSZWNvcmQgdGhhdCB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBub3cgYmVlbiBwcmVzZW50ZWQsIHJldHVybmluZ1xuICAgKiB3aGV0aGVyIHRoZSByZWNvcmQgYWN0dWFsbHkgcGVyc2lzdGVkLiBgZmFsc2VgIG1lYW5zIHRoZSBtZW1vIGNvdWxkIG5vdCBiZVxuICAgKiB3cml0dGVuIChlLmcuIGFuIHVud3JpdGFibGUgbWVtbyBkaXJlY3RvcnkpIFx1MjAxNCB0aGUgZ2F0ZSB0cmVhdHMgdGhhdCBhcyBhXG4gICAqIGZhaWwtb3BlbiBzaWduYWwgcmF0aGVyIHRoYW4gZGVueWluZywgYmVjYXVzZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGRcbiAgICogc2lsZW50bHkgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGUgaWRlbnRpY2FsIHJldHJ5XCIgaW50byBcImRlbnkgZXZlcnlcbiAgICogdGltZVwiIHdpdGggbm8gZXNjYXBlLlxuICAgKi9cbiAgcmVjb3JkKGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBUaGUgZ2F0ZSdzIGRlY2lzaW9uIGZvciBvbmUgY29tbWFuZCwgYXMgYSBkaXNjcmltaW5hdGVkIHVuaW9uIHRoZSBhZGFwdGVyXG4gKiB0cmFuc2xhdGVzIGludG8gYHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknYC9hbGxvdyAoQ2xhdWRlKSBvciBhIGJsb2NrL2FsbG93XG4gKiAoQ29kZXgpLiBgZGVjaXNpb25gIGlzIHRoZSBjb2Fyc2UgYWxsb3cvZGVueSB0aGUgaGFybmVzcyBhY3RzIG9uOyBga2luZGBcbiAqIHJlY29yZHMgKndoeSosIHNvIHRoZSBhZGFwdGVyIHJlbmRlcnMgdGhlIHJpZ2h0IG1lc3NhZ2UgYW5kIHNvIHRlc3RzIGFzc2VydFxuICogdGhlIGV4YWN0IGJyYW5jaC5cbiAqXG4gKiAtIGBhbGxvd2AgLyBgc2lsZW50YCBcdTIwMTQgbm90aGluZyB0byBjaGVjayAobm8gcGF0aHMpIG9yIHRoZSBjaGFuZ2VzZXQgaXMgY2xlYW47XG4gKiAgIGFsbG93IHdpdGggbm8gb3V0cHV0LiBJbnRlcm5hbCBlcnJvcnMgYW5kIHBhcnNlIGZhaWx1cmVzIGFsc28gcmVzb2x2ZSBoZXJlOlxuICogICB0aGUgZ2F0ZSBmYWlscyBvcGVuIGFuZCBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LlxuICogLSBgYWxsb3dgIC8gYGFscmVhZHktcHJlc2VudGVkYCBcdTIwMTQgZGVidCBpcyBwcmVzZW50LCBidXQgdGhpcyBleGFjdCBkZWJ0IHN0YXRlXG4gKiAgIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlIChzZW1hbnRpYy1zdGFsZW5lc3Mgb3IgdW5jb3ZlcmVkLXdyaXRlc1xuICogICBjb25zaWRlci1vbmNlLCBvciBhbiB1bmNoYW5nZWQgc3RhdGUpLiBUaGUgY29tbWFuZCBwYXNzZXMuXG4gKiAtIGBhbGxvd2AgLyBgZW52aXJvbm1lbnRhbGAgXHUyMDE0IHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyByb3dzIGFyZVxuICogICB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgKGBDT05GTElDVGAsIGBTVUJNT0RVTEVgLCBgTEZTXypgLFxuICogICBgUFJPTUlTT1JfTUlTU0lOR2AsIGBTUEFSU0VfRVhDTFVERURgLCBgRklMVEVSX0ZBSUxFRGAsIGBJT19FUlJPUmApIHRoZSBDTElcbiAqICAgY291bGQgbm90IHJlc29sdmUgYXQgYWxsIFx1MjAxNCBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi5cbiAqICAgVGhlIGdhdGUgZmFpbHMgT1BFTiAoYWxsb3cpIGJ1dCBjYXJyaWVzIGBjb25kaXRpb25zYC9gcmVhc29uYCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyB0aGUgY29uZGl0aW9uIGluc3RlYWQgb2Ygc3dhbGxvd2luZyBpdC4gRGVueWluZyBoZXJlIHdvdWxkIHJlLWRlbnlcbiAqICAgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIHRoZSBnYXRlLlxuICogLSBgYWxsb3dgIC8gYHNjYW4tZmFpbGVkYCBcdTIwMTQgYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHMgc2NvcGVkXG4gKiAgIHNjYW4gKGEge0BsaW5rIEdhdGVTY2FuRXJyb3J9LCBlLmcuIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUgYWJvcnRpbmcgdGhlXG4gKiAgIHdob2xlIHF1ZXJ5KS4gVGhpcyBpcyBkaXN0aW5jdCBmcm9tIGJvdGggYGVudmlyb25tZW50YWxgICh0aGUgc2NhbiBjb21wbGV0ZWRcbiAqICAgYW5kIGNhcnJpZWQgdGVybWluYWwgcm93cykgYW5kIGEgY2xlYW4gcGFzcyAodGhlIHNjYW4gY29tcGxldGVkIHdpdGggemVyb1xuICogICByb3dzKTogdGhlIHNjYW4gbmV2ZXIgcmFuIHRvIGNvbXBsZXRpb24sIHNvIGl0cyBlbXB0eSByZXN1bHQgaXMgbm90IGV2aWRlbmNlXG4gKiAgIG9mIFwibm8gZGVidC5cIiBUaGUgZ2F0ZSBmYWlscyBPUEVOIGhlcmUgdG9vIFx1MjAxNCBtYXRjaGluZyBgZW52aXJvbm1lbnRhbGAgXHUyMDE0XG4gKiAgIGJ1dCBrZWVwcyBpdHMgb3duIGBraW5kYCBhbmQgYSBgcmVhc29uYCBuYW1pbmcgdGhlIGZhaWx1cmUsIHNvIHRoZSBhZGFwdGVyXG4gKiAgIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzIGNoYW5nZXNldFxuICogICBpbnN0ZWFkIG9mIHN0YXlpbmcgc2lsZW50LiBUaGVyZSBpcyBubyBkZWJ0LXN0YXRlIHRvIG1lbW9pemU6IGV2ZXJ5XG4gKiAgIGV2YWx1YXRpb24gb2YgYSBzdGlsbC1mYWlsaW5nIHNjYW4gd2FybnMgYWdhaW4uXG4gKiAtIGBkZW55YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3NgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGNhcnJpZXMgc2VtYW50aWMgc3RhbGVuZXNzLFxuICogICBhbmQgdGhpcyBleGFjdCBmaW5kaW5ncyBkaWdlc3QgaGFzIG5vdCBiZWVuIHByZXNlbnRlZCBiZWZvcmUuIERlbnlcbiAqICAgKipvbmNlKiosIGxpc3RpbmcgYGZpbmRpbmdzYCBhcyBhIGNoZWNrbGlzdCBpbiBgcmVhc29uYDsgYW4gaWRlbnRpY2FsXG4gKiAgIHJldHJ5ICh1bmNoYW5nZWQgZmluZGluZ3MpIGZhbGxzIHRocm91Z2ggdG8gdGhlIGVudmlyb25tZW50YWwgYW5kXG4gKiAgIHVuY292ZXJlZCBjaGVja3MgYW5kIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGAgd2hlbiBvdGhlcndpc2VcbiAqICAgY2xlYW4uIENoYW5nZWQgZmluZGluZ3MgKGEgbmV3IGRpZ2VzdCkgZGVueSBmcmVzaCAoY29uc2lkZXItb25jZSBwZXJcbiAqICAgZGlzdGluY3QgZGVidCBzdGF0ZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEpLlxuICogLSBgZGVueWAgLyBgdW5jb3ZlcmVkLXdyaXRlc2AgXHUyMDE0IHRoZSBjaGFuZ2VzZXQgaGFzIGNoYW5nZWQgZmlsZXMgbm8gc3BhblxuICogICBjb3ZlcnMsIGFuZCB0aGlzIHN0YXRlIGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlLiBEZW55ICoqb25jZSoqLCBsaXN0aW5nXG4gKiAgIGB1bmNvdmVyZWRgOyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUgcmVzb2x2ZXMgdG8gYGFscmVhZHktcHJlc2VudGVkYFxuICogICBhbmQgcGFzc2VzIChjb25zaWRlci1vbmNlLCBwZXIgZGVzaWduLWRlY2lzaW9ucy5tZCAjMykuXG4gKiAtIGBhbGxvd2AgLyBgc2VtYW50aWMtc3RhbGVuZXNzLWluZm9gLCBgYWxsb3dgIC8gYHVuY292ZXJlZC13cml0ZXMtaW5mb2AgXHUyMDE0XG4gKiAgIGAnaW5mb3JtJ2AtbW9kZS1vbmx5IGNvdW50ZXJwYXJ0cyBvZiB0aGUgdHdvIGBkZW55YCBraW5kcyBhYm92ZTogc2FtZVxuICogICBgZmluZGluZ3NgL2B1bmNvdmVyZWRgL2ByZWFzb25gIHBheWxvYWQsIGJ1dCBuZXZlciBkZW5pZXMgYW5kIG5ldmVyXG4gKiAgIGNvbnN1bHRzIG9yIHdyaXRlcyBgbWVtb1N0YXRlYCAoYSBgZ2l0IHN0YXR1c2AgcHJldmlldyBpcyBub3QgYSBkZWJ0IHN0YXRlXG4gKiAgIHRvIGhvbGQgb3IgY29uc2lkZXItb25jZSBcdTIwMTQgaXQgcmUtcmVwb3J0cyB0aGUgc2FtZSBsaXZlIGRlYnQgb24gZXZlcnkgY2FsbCxcbiAqICAgZXhhY3RseSBsaWtlIGBnaXQgc3RhdHVzYCBpdHNlbGYgZG9lcyBmb3IgdGhlIHdvcmtpbmcgdHJlZSkuXG4gKi9cbmV4cG9ydCB0eXBlIEdhdGVSZXN1bHQgPVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdzaWxlbnQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnZW52aXJvbm1lbnRhbCc7IGNvbmRpdGlvbnM6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2Nhbi1mYWlsZWQnOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcyc7IGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcyc7IHVuY292ZXJlZDogc3RyaW5nW107IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKlxuICogV2hldGhlciB7QGxpbmsgZXZhbHVhdGVHYXRlfSBtYXkgaG9sZCB0aGUgY29tbWFuZCAoYCdlbmZvcmNlJ2AsIHRoZSBkZWZhdWx0IFx1MjAxNFxuICogdXNlZCBmb3IgYGNvbW1pdGAvYHB1c2hgKSBvciBtdXN0IG9ubHkgZXZlciBhZHZpc2UgKGAnaW5mb3JtJ2AgXHUyMDE0IHVzZWQgZm9yXG4gKiBgc3RhdHVzYCk6IGV2ZXJ5IGJyYW5jaCB0aGF0IHdvdWxkIG90aGVyd2lzZSBgZGVueWAgcmV0dXJucyBpdHMgYC1pbmZvYFxuICogYGFsbG93YCBjb3VudGVycGFydCBpbnN0ZWFkLCBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuLCBzaW5jZVxuICogYW4gaW5mb3JtYXRpb25hbCBwcmV2aWV3IG11c3Qgbm90IHNwZW5kIChvciBiZSBibG9ja2VkIGJ5KSB0aGUgY29uc2lkZXItb25jZVxuICogY3JlZGl0IGEgcmVhbCBgY29tbWl0YC9gcHVzaGAgcmVsaWVzIG9uLlxuICovXG5leHBvcnQgdHlwZSBHYXRlTW9kZSA9ICdlbmZvcmNlJyB8ICdpbmZvcm0nO1xuXG4vKipcbiAqIEV2YWx1YXRlIHRoZSBnYXRlIGZvciBhIHJlc29sdmVkIGNoYW5nZXNldCBhbmQgZGVjaWRlIHdoZXRoZXIgdG8gaG9sZCB0aGVcbiAqIGNvbW1hbmQuXG4gKlxuICogUnVucyBgZXhlY3V0b3JzLmZpeGAgKHNjb3BlZCBiZWx0LWFuZC1icmFjZXMgYHN0YWxlIC0tZml4YCksIHRoZW4gcmVhZHNcbiAqIGBleGVjdXRvcnMuc3RhbGVgIGFuZCBjbGFzc2lmaWVzIGVhY2ggZGVidCByb3cgKGBpc0RlYnQoKWApIGludG8gKnNlbWFudGljKlxuICogZHJpZnQgYW5kICplbnZpcm9ubWVudGFsKiBjb25kaXRpb25zIChgaXNFbnZpcm9ubWVudGFsU3RhdHVzKClgKS5cbiAqXG4gKiBTZW1hbnRpYyBkcmlmdCAoYENIQU5HRURgL2BERUxFVEVEYCkgaXMgY2hlY2tlZCBhZ2FpbnN0IGBtZW1vU3RhdGVgIHZpYSBpdHNcbiAqIG93biBkaWdlc3QgKGBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKWApLCB0aGUgc2FtZSBkaXN0aW5jdC1kZWJ0LXN0YXRlXG4gKiBtZW1vIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIGFscmVhZHkgdXNlczogbm90IHlldCBwcmVzZW50ZWQgXHUyMTkyIHJlY29yZCBpdFxuICogYW5kIGBkZW55YC9gc2VtYW50aWMtc3RhbGVuZXNzYCAoYSBgbWVtb1N0YXRlLnJlY29yZGAgZmFpbHVyZSBmYWlscyBvcGVuIHRvXG4gKiBgYWxsb3dgL2BzaWxlbnRgLCBzaW5jZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGQgcmUtZGVueSB0aGUgaWRlbnRpY2FsXG4gKiByZXRyeSBmb3JldmVyKTsgYWxyZWFkeSBwcmVzZW50ZWQgXHUyMTkyICoqZmFsbCB0aHJvdWdoKiogcmF0aGVyIHRoYW4gcmV0dXJuaW5nLFxuICogc28gYSByZXRyeSBzdGlsbCBzdXJmYWNlcyBlbnZpcm9ubWVudGFsIGFkdmlzb3JpZXMgYW5kIHN0aWxsIHJ1bnMgdGhlXG4gKiB1bmNvdmVyZWQgY2hlY2suIFdoZXRoZXIgdGhlIHNlbWFudGljIHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBpc1xuICogdHJhY2tlZCBzbyB0aGF0LCBpZiB0aGUgZXZhbHVhdGlvbiB0aGVuIGVuZHMgY2xlYW4sIGl0IHJlc29sdmVzIHRvXG4gKiBgYWxsb3dgL2BhbHJlYWR5LXByZXNlbnRlZGAgcmF0aGVyIHRoYW4gYSBiYXJlIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IG1pcnJvcmluZ1xuICogdGhlIHVuY292ZXJlZCBicmFuY2gncyBvd24gbWVtby1oaXQgcmVzdWx0LiBBIGNoYW5nZXNldCBjYXJyeWluZyBib3RoXG4gKiB1bnByZXNlbnRlZCBzZW1hbnRpYyBzdGFsZW5lc3MgYW5kIHVucHJlc2VudGVkIHVuY292ZXJlZCB3cml0ZXMgdGhlcmVmb3JlXG4gKiBkZW5pZXMgdHdpY2UgKHN0YWxlbmVzcyBmaXJzdCwgdW5jb3ZlcmVkIG9uIHRoZSByZXRyeSkgYmVmb3JlIGEgdGhpcmRcbiAqIGF0dGVtcHQgcGFzc2VzOyBlZGl0aW5nIG9uZSBzdGFsZSBzcGFuIHdoaWxlIGFub3RoZXIgcmVtYWlucyBzdGFsZSBwcm9kdWNlc1xuICogYSBuZXcgZmluZGluZ3Mgc2V0LCBoZW5jZSBhIG5ldyBkaWdlc3QgYW5kIG9uZSBmcmVzaCBkZW55LiBEaWdlc3QgY29sbGlzaW9uXG4gKiBiZXR3ZWVuIHRoZSB0d28gY2F0ZWdvcmllcyBpcyBpbXBvc3NpYmxlOiB0aGUgcGF5bG9hZCBpc1xuICogYEpTT04uc3RyaW5naWZ5KHtmaW5kaW5ncywgdW5jb3ZlcmVkfSlgLCBhbmQgdGhlIHNlbWFudGljIGRpZ2VzdCBwb3B1bGF0ZXNcbiAqIGBmaW5kaW5nc2Agd2hpbGUgdGhlIHVuY292ZXJlZCBkaWdlc3QgcG9wdWxhdGVzIGB1bmNvdmVyZWRgLlxuICpcbiAqIEVudmlyb25tZW50YWwgY29uZGl0aW9ucyB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbFxuICogKGBDT05GTElDVGAvYFNVQk1PRFVMRWAvYExGU18qYC9gUFJPTUlTT1JfTUlTU0lOR2AvYFNQQVJTRV9FWENMVURFRGAvXG4gKiBgRklMVEVSX0ZBSUxFRGAvYElPX0VSUk9SYCkgXHUyMTkyIGBhbGxvd2AvYGVudmlyb25tZW50YWxgOiBmYWlsIE9QRU4sIHN1cmZhY2luZyB0aGVcbiAqIGNvbmRpdGlvbiByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGFuIGluZnJhIGZhaWx1cmUgYSBzcGFuIGVkaXQgY2Fubm90IGZpeC5cbiAqIFVuY292ZXJlZCB3cml0ZXMgKGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyYWdlIGZyb20gYGV4ZWN1dG9ycy5saXN0YCxcbiAqIG1pbnVzIGAuc3Bhbi8qKmAsIGFuZCBwYXRocyBtYXRjaGVkIGJ5IHRoZSByZXBvJ3MgYC5zcGFuLy5nYXRlaWdub3JlYCBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9LCBsb2FkZWQgZGlyZWN0bHkgZnJvbSBkaXNrIHZpYVxuICogYHJlc29sdmVSZXBvUm9vdChjd2QpYCwgZmFpbC1vcGVuIHdoZW4gYWJzZW50L3VucmVhZGFibGUpIFx1MjE5MlxuICogYGRlbnlgL2B1bmNvdmVyZWQtd3JpdGVzYCB0aGUgZmlyc3QgdGltZSB0aGF0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCBvbiByZXRyeS4gYE1PVkVEYCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogbmV2ZXIgY29udHJpYnV0ZSB0byBhbnkgYnJhbmNoIGFuZCBuZXZlciBkZW55LiBBbnkgaW50ZXJuYWwgZXJyb3IgcmVzb2x2ZXNcbiAqIHRvIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG5ldmVyIGJyaWNrcyBhIGNvbW1pdC5cbiAqXG4gKiBBIHtAbGluayBHYXRlU2NhbkVycm9yfSBmcm9tIGBleGVjdXRvcnMuc3RhbGVgIGlzIHRoZSBvbmUgY2FzZSBoYW5kbGVkXG4gKiBvdXRzaWRlIHRoYXQgZmxvdzogYSBzY2FuIHRoYXQgKmNvdWxkIG5vdCBjb21wbGV0ZSogKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSBzY29wZWQgcXVlcnkpIHlpZWxkcyBhbiBlbXB0eSByZXN1bHQgdGhhdCBpcyBOT1RcbiAqIGV2aWRlbmNlIG9mIGEgY2xlYW4gY2hhbmdlc2V0LiBSZWFkaW5nIHRoYXQgYXMgYGFsbG93YC9gc2lsZW50YCB3b3VsZFxuICogc2lsZW50bHkgc3dhbGxvdyB0aGUgZmFjdCB0aGF0IHZlcmlmaWNhdGlvbiBuZXZlciBoYXBwZW5lZCwgc28gaXQgcmVzb2x2ZXNcbiAqIGluc3RlYWQgdG8gaXRzIG93biBgYWxsb3dgL2BzY2FuLWZhaWxlZGAgXHUyMDE0IGZhaWwgT1BFTiBsaWtlIGBlbnZpcm9ubWVudGFsYFxuICogKHRoZSBjb21tYW5kIGlzIG5vdCBoZWxkKSwgYnV0IHdpdGggYSBkaXN0aW5jdCBga2luZGAgYW5kIGByZWFzb25gIHNvIHRoZVxuICogYWRhcHRlciBzdXJmYWNlcyBhIHdhcm5pbmcgdGhhdCBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZCBmb3IgdGhpc1xuICogY2hhbmdlc2V0IHJhdGhlciB0aGFuIHN0YXlpbmcgc2lsZW50LiBUaGVyZSBpcyBubyBkZWJ0LXN0YXRlIHRvIG1lbW9pemVcbiAqIGhlcmU6IGV2ZXJ5IGV2YWx1YXRpb24gb2YgYSBzdGlsbC1mYWlsaW5nIHNjYW4gd2FybnMgYWdhaW4uXG4gKlxuICogSW4gYCdpbmZvcm0nYCBtb2RlIChgc3RhdHVzYCksIHRoZSBzYW1lIGNsYXNzaWZpY2F0aW9uIHJ1bnMgYnV0IG5laXRoZXJcbiAqIGBkZW55YCBicmFuY2ggZmlyZXMgYW5kIGBtZW1vU3RhdGVgIGlzIG5ldmVyIHJlYWQgb3Igd3JpdHRlbjogc2VtYW50aWNcbiAqIHN0YWxlbmVzcyByZXNvbHZlcyB0byBgYWxsb3dgL2BzZW1hbnRpYy1zdGFsZW5lc3MtaW5mb2AgYW5kIHVuY292ZXJlZFxuICogd3JpdGVzIHRvIGBhbGxvd2AvYHVuY292ZXJlZC13cml0ZXMtaW5mb2AsIGJvdGggY2FycnlpbmcgdGhlIHNhbWVcbiAqIGBmaW5kaW5nc2AvYHVuY292ZXJlZGAvYHJlYXNvbmAgcGF5bG9hZCB0aGUgYGRlbnlgIGtpbmRzIHdvdWxkIGhhdmUuIFRoZVxuICogZW52aXJvbm1lbnRhbC9zY2FuLWZhaWxlZC9zaWxlbnQgYnJhbmNoZXMgYXJlIHVuYWZmZWN0ZWQgYnkgbW9kZSBcdTIwMTQgdGhleVxuICogYWxyZWFkeSBhbHdheXMgYWxsb3cuXG4gKlxuICogQHBhcmFtIHBhdGhzIFRoZSByZXNvbHZlZCBjaGFuZ2VzZXQgZnJvbSB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0uIEVtcHR5IFx1MjE5MlxuICogICBgYWxsb3dgL2BzaWxlbnRgLlxuICogQHBhcmFtIGN3ZCBUaGUgd29ya2luZyBkaXJlY3RvcnkgdGhlIGdpdCBjb21tYW5kIHJhbiBpbi5cbiAqIEBwYXJhbSBleGVjdXRvcnMgVGhlIGluamVjdGVkIGBmaXhgL2BzdGFsZWAvYGxpc3RgIHN1cmZhY2UuXG4gKiBAcGFyYW0gbWVtb1N0YXRlIFRoZSBwZXItY2hhbmdlc2V0IGRlYnQtc3RhdGUgbWVtby4gVW51c2VkIGluIGAnaW5mb3JtJ2AgbW9kZS5cbiAqIEBwYXJhbSBtb2RlIGAnZW5mb3JjZSdgIChkZWZhdWx0KSBtYXkgZGVueTsgYCdpbmZvcm0nYCBvbmx5IGV2ZXIgYWR2aXNlcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV2YWx1YXRlR2F0ZShcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBjd2Q6IHN0cmluZyxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLFxuICBtZW1vU3RhdGU6IEdhdGVNZW1vU3RhdGUsXG4gIG1vZGU6IEdhdGVNb2RlID0gJ2VuZm9yY2UnXG4pOiBQcm9taXNlPEdhdGVSZXN1bHQ+IHtcbiAgaWYgKHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gIHRyeSB7XG4gICAgLy8gQmVsdC1hbmQtYnJhY2VzIGhlYWwsIHRoZW4gY2xhc3NpZnkgYWdhaW5zdCB0aGUgaGVhbGVkIHN0YXRlLlxuICAgIGF3YWl0IGV4ZWN1dG9ycy5maXgocGF0aHMsIGN3ZCk7XG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZXhlY3V0b3JzLnN0YWxlKHBhdGhzLCBjd2QpO1xuXG4gICAgLy8gU3BsaXQgZGVidCByb3dzIGludG8gc2VtYW50aWMgZHJpZnQgKGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuKVxuICAgIC8vIGFuZCB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgKHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlXG4gICAgLy8gYW5jaG9yIGF0IGFsbCBcdTIwMTQgc3BhcnNlIGNoZWNrb3V0LCB1bmZldGNoZWQgTEZTLCBwYXJ0aWFsLWNsb25lIG1pc3MsIEkvT1xuICAgIC8vIGVycm9yKS4gYGlzRGVidCgpYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3Igd2hhdCBpcyBkZWJ0IGF0IGFsbDtcbiAgICAvLyBgaXNFbnZpcm9ubWVudGFsU3RhdHVzKClgIHNwbGl0cyB0aGUgZml4YWJsZSBmcm9tIHRoZSB1bnJlc29sdmFibGUuXG4gICAgLy8gYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBjb250cmlidXRlLlxuICAgIGNvbnN0IGRlYnRSb3dzID0gc3RhbGVSb3dzLmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGNvbnN0IHNlbWFudGljID0gZGVidFJvd3MuZmlsdGVyKChyb3cpID0+ICFpc0Vudmlyb25tZW50YWxTdGF0dXMocm93LnN0YXR1cykpO1xuICAgIGNvbnN0IGVudmlyb25tZW50YWwgPSBkZWJ0Um93cy5maWx0ZXIoKHJvdykgPT4gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHJvdy5zdGF0dXMpKTtcblxuICAgIGlmIChtb2RlID09PSAnaW5mb3JtJykge1xuICAgICAgLy8gQSBzdGF0dXMgcHJldmlldyBuZXZlciBkZW5pZXMgYW5kIG5ldmVyIHRvdWNoZXMgdGhlIGVuZm9yY2VcbiAgICAgIC8vIGNvbnNpZGVyLW9uY2UgZGVueSBjcmVkaXQgXHUyMDE0IGl0IHJlcG9ydHMgd2hhdGV2ZXIgZGVidCBpcyBsaXZlIHJpZ2h0XG4gICAgICAvLyBub3csIGV2ZXJ5IHRpbWUgaXQncyBhc2tlZC4gSXQgZG9lcywgaG93ZXZlciwgbWFyayB0aGUgZGVidCBzdGF0ZSBhc1xuICAgICAgLy8gXCJzZWVuXCIgKGEgc2VwYXJhdGUgYXhpcyBmcm9tIHRoZSBkZW55IGNyZWRpdCkgc28gYW4gZW5mb3JjZVxuICAgICAgLy8gZXZhbHVhdGlvbiBvZiB0aGUgc2FtZSB1bmNoYW5nZWQgc3RhdGUgbW9tZW50cyBsYXRlciBcdTIwMTQgZS5nLiBhIGBnaXRcbiAgICAgIC8vIGNvbW1pdGAgcmlnaHQgYWZ0ZXIgdGhlIGBnaXQgc3RhdHVzYCB0aGF0IGp1c3Qgc2hvd2VkIHRoaXMgXHUyMDE0IHJlbmRlcnNcbiAgICAgIC8vIGEgY29uZGVuc2VkIHJlbWluZGVyIGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBpZGVudGljYWwgY2hlY2tsaXN0LlxuICAgICAgaWYgKHNlbWFudGljLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgZ2F0ZVN0YXRlRGlnZXN0KHNlbWFudGljLCBbXSkpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnYWxsb3cnLFxuICAgICAgICAgIGtpbmQ6ICdzZW1hbnRpYy1zdGFsZW5lc3MtaW5mbycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBzZW1hbnRpYywgY3dkKSwgJ2luZm9ybScsIHNlZW4pXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IGVudmlyb25tZW50YWwsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGVudmlyb25tZW50YWwsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIGVudmlyb25tZW50YWwsIGN3ZCkpXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjb25zdCB1bmNvdmVyZWQgPSBhd2FpdCBjb21wdXRlVW5jb3ZlcmVkUGF0aHMocGF0aHMsIGN3ZCwgZXhlY3V0b3JzKTtcbiAgICAgIGlmICh1bmNvdmVyZWQubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICAgIGNvbnN0IHNlZW4gPSB3YXNBbHJlYWR5U2VlbihtZW1vU3RhdGUsIGdhdGVTdGF0ZURpZ2VzdChbXSwgdW5jb3ZlcmVkKSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ3VuY292ZXJlZC13cml0ZXMtaW5mbycsXG4gICAgICAgIHVuY292ZXJlZCxcbiAgICAgICAgcmVhc29uOiByZW5kZXJVbmNvdmVyZWRSZWFzb24odW5jb3ZlcmVkLCAnaW5mb3JtJywgc2VlbilcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU2VtYW50aWMgc3RhbGVuZXNzIGpvaW5zIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGUgbWVtbyB0aGUgdW5jb3ZlcmVkXG4gICAgLy8gY2hlY2sgdXNlczogZGVueSBvbmNlIHBlciBmaW5kaW5ncyBkaWdlc3QsIHRoZW4gZmFsbCB0aHJvdWdoIChyYXRoZXIgdGhhblxuICAgIC8vIHJldHVybmluZykgb24gYW4gaWRlbnRpY2FsIHJldHJ5IHNvIHRoZSByZXN0IG9mIHRoZSBldmFsdWF0aW9uIHN0aWxsIHJ1bnMuXG4gICAgbGV0IHNlbWFudGljQWxyZWFkeVByZXNlbnRlZCA9IGZhbHNlO1xuICAgIGlmIChzZW1hbnRpYy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzZW1hbnRpY0RpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pO1xuICAgICAgaWYgKCFtZW1vU3RhdGUuaGFzKHNlbWFudGljRGlnZXN0KSkge1xuICAgICAgICAvLyBBIG5vbi1wZXJzaXN0aW5nIG1lbW8gd3JpdGUgd291bGQgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGVcbiAgICAgICAgLy8gcmV0cnlcIiBpbnRvIFwiZGVueSBldmVyeSB0aW1lXCIgd2l0aCBubyBlc2NhcGUgXHUyMDE0IGZhaWwgb3BlbiBpbnN0ZWFkLlxuICAgICAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoc2VtYW50aWNEaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgc2VtYW50aWNEaWdlc3QpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBzZW1hbnRpYywgY3dkKSwgJ2VuZm9yY2UnLCBzZWVuKVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBFbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgYXJlIG5vdCBhIHNwYW4gZWRpdCBhd2F5IGZyb20gcmVzb2x1dGlvbjogZmFpbFxuICAgIC8vIE9QRU4gKGFsbG93KSBcdTIwMTQgYnV0IGNhcnJ5IHRoZW0gc28gdGhlIGFkYXB0ZXIgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiByYXRoZXJcbiAgICAvLyB0aGFuIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgd291bGQgcmUtZGVueSBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlXG4gICAgLy8gdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZSwgY29udHJhZGljdGluZyB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZVxuICAgIC8vIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZSBmYWlsdXJlcy5cbiAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICBjb25kaXRpb25zOiBlbnZpcm9ubWVudGFsLFxuICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVW5jb3ZlcmVkIHdyaXRlczogY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiwgbWludXMgYC5zcGFuLyoqYFxuICAgIC8vIChzcGFuIHJlcGFpcnMgcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKVxuICAgIC8vIGFuZCBwYXRocyB0aGUgcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcy4gR2l0aWdub3JlZFxuICAgIC8vIHBhdGhzIG5ldmVyIHJlYWNoIGhlcmUgXHUyMDE0IGdpdCBkb2VzIG5vdCBzdGFnZS9wdWJsaXNoIHRoZW0uXG4gICAgY29uc3QgdW5jb3ZlcmVkID0gYXdhaXQgY29tcHV0ZVVuY292ZXJlZFBhdGhzKHBhdGhzLCBjd2QsIGV4ZWN1dG9ycyk7XG4gICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEEgcmV0cnkgdGhhdCBmZWxsIHRocm91Z2ggcGFzdCBhbiBhbHJlYWR5LXByZXNlbnRlZCBzZW1hbnRpYy1zdGFsZW5lc3NcbiAgICAgIC8vIGRpZ2VzdCBlbmRzIGNsZWFuIGhlcmU6IHN1cmZhY2UgYWxyZWFkeS1wcmVzZW50ZWQgcmF0aGVyIHRoYW4gYSBiYXJlXG4gICAgICAvLyBzaWxlbnQgYWxsb3csIG1pcnJvcmluZyB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuXG4gICAgICByZXR1cm4gc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkXG4gICAgICAgID8geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gICAgICAgIDogeyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICB9XG5cbiAgICAvLyBDb25zaWRlci1vbmNlOiBkZW55IHRoZSBmaXJzdCB0aW1lIHRoaXMgZXhhY3QgZGVidCBzdGF0ZSBpcyBzZWVuLCB0aGVuXG4gICAgLy8gcGFzcyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUuIChObyBzZW1hbnRpYyByb3dzIHN1cnZpdmUgdG9cbiAgICAvLyBoZXJlIHVucHJlc2VudGVkIFx1MjAxNCB0aGUgc2VtYW50aWMgYnJhbmNoIGFib3ZlIGhhcyBhbHJlYWR5IHJldHVybmVkIGZvclxuICAgIC8vIHRoYXQgY2FzZSBcdTIwMTQgc28gdGhlIGRpZ2VzdCdzIGZpbmRpbmdzIGNvbXBvbmVudCBpcyBlbXB0eSBhbmQgdGhlIHN0YXRlXG4gICAgLy8gaXMga2V5ZWQgYnkgdGhlIHVuY292ZXJlZCBzZXQuKVxuICAgIGNvbnN0IGRpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChbXSwgdW5jb3ZlcmVkKTtcbiAgICBpZiAobWVtb1N0YXRlLmhhcyhkaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9O1xuICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSByZXRyeVwiXG4gICAgLy8gaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gcmF0aGVyIHRoYW4gZGVueS5cbiAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgZGlnZXN0KTtcbiAgICByZXR1cm4ge1xuICAgICAgZGVjaXNpb246ICdkZW55JyxcbiAgICAgIGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJyxcbiAgICAgIHVuY292ZXJlZCxcbiAgICAgIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCwgJ2VuZm9yY2UnLCBzZWVuKVxuICAgIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIEEgc2NhbiB0aGF0IGNvdWxkIG5vdCBDT01QTEVURSBpcyBub3QgYSBjbGVhbiByZXN1bHQsIGJ1dCBpdCBpcyBub3RcbiAgICAvLyBkZWJ0IGVpdGhlciBcdTIwMTQgdGhlcmUgaXMgbm90aGluZyBoZXJlIGZvciBhIHVzZXIgdG8gcmVzb2x2ZSBieSBlZGl0aW5nIGFcbiAgICAvLyBzcGFuLiBGYWlsIE9QRU4gd2l0aCBhIGRpc3Rpbmd1aXNoYWJsZSBgc2Nhbi1mYWlsZWRgIHdhcm5pbmcgaW5zdGVhZCBvZlxuICAgIC8vIHNpbGVudGx5IHJlYWRpbmcgdGhlIGFib3J0ZWQgc2NhbidzIGVtcHR5IHJlc3VsdCBhcyBjbGVhbi5cbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgR2F0ZVNjYW5FcnJvcikge1xuICAgICAgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzY2FuLWZhaWxlZCcsIHJlYXNvbjogcmVuZGVyU2NhbkZhaWxlZFJlYXNvbihlcnIuZGV0YWlsKSB9O1xuICAgIH1cbiAgICAvLyBGYWlsIG9wZW46IGFueSBvdGhlciBpbnRlcm5hbC9DTEkgZXJyb3IgcmVzb2x2ZXMgdG8gYWxsb3cuIFRoZSBnYXRlIG11c3RcbiAgICAvLyBuZXZlciBicmljayBhIGNvbW1pdCBvbiBpdHMgb3duIGZhaWx1cmUuXG4gICAgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiBcdTIwMTQgbWludXMgYC5zcGFuLyoqYCAoc3BhbiByZXBhaXJzXG4gKiByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpIGFuZCBwYXRocyB0aGVcbiAqIHJlcG8ncyB1c2VyLW93bmVkIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgKGZhaWwtb3BlbiB3aGVuIGFic2VudC9cbiAqIHVucmVhZGFibGUpLiBTaGFyZWQgYnkgYGV2YWx1YXRlR2F0ZWAncyBgJ2VuZm9yY2UnYCBhbmQgYCdpbmZvcm0nYCBicmFuY2hlcyxcbiAqIHdoaWNoIGRpZmZlciBvbmx5IGluIHdoYXQgdGhleSBkbyB3aXRoIHRoZSByZXN1bHQgKGRlbnktb25jZSB2cy4gYW5cbiAqIGFsd2F5cy1mcmVzaCBhZHZpc29yeSkuXG4gKlxuICogQSBjaGFuZ2VzZXQgb2YgZmV3ZXIgdGhhbiB0d28gZmlsZXMgY2FuIG5ldmVyIGNhcnJ5IGFuIGltcGxpY2l0ICpjcm9zcy1maWxlKlxuICogZGVwZW5kZW5jeSBcdTIwMTQgZ2l0LXNwYW4gcmVjb3JkcyBjb3VwbGluZ3MgYmV0d2VlbiBmaWxlL2xpbmUgcmFuZ2VzIGFjcm9zc1xuICogZmlsZXMgXHUyMDE0IHNvIGEgc2luZ2xlLWZpbGUgKG9yIGVtcHR5KSBjaGFuZ2VzZXQgc2hvcnQtY2lyY3VpdHMgdG8gbm9cbiAqIHVuY292ZXJlZCBwYXRocyByYXRoZXIgdGhhbiBwcm9tcHRpbmcgZm9yIGEgY291cGxpbmcgdGhhdCBjYW5ub3QgZXhpc3QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVVbmNvdmVyZWRQYXRocyhwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGlmIChwYXRocy5sZW5ndGggPCAyKSByZXR1cm4gW107XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QocGF0aHMsIGN3ZCk7XG4gIGNvbnN0IGNvdmVyZWQgPSBuZXcgU2V0KGNvdmVyaW5nLm1hcCgocm93KSA9PiByb3cucGF0aCkpO1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBjb25zdCBnYXRlSWdub3JlUnVsZXMgPSByZXBvUm9vdCA/IGxvYWRHYXRlSWdub3JlKHJlcG9Sb290KSA6IFtdO1xuICByZXR1cm4gcGF0aHMuZmlsdGVyKChwYXRoKSA9PiAhY292ZXJlZC5oYXMocGF0aCkgJiYgIWlzSW5zaWRlU3BhblJvb3QocGF0aCkgJiYgIWlzR2F0ZUlnbm9yZWQoZ2F0ZUlnbm9yZVJ1bGVzLCBwYXRoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidC1zdGF0ZSBkaWdlc3QgYW5kIHJlYXNvbiByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYHBhdGgjTHN0YXJ0LUxlbmRgLCBvciBhIGJhcmUgcGF0aCBmb3IgYSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBTdGFsZVBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG4vKipcbiAqIFRoZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIGRpZ2VzdCAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSk6IGEgc3RhYmxlIGhhc2ggb2YgdGhlXG4gKiBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMuIFByZXNlbmNlIGluIHRoZVxuICogbWVtbyBtZWFucyBcInRoaXMgZXhhY3Qgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCJcbiAqL1xuZnVuY3Rpb24gZ2F0ZVN0YXRlRGlnZXN0KGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCB1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgZmluZGluZ0tleXMgPSBmaW5kaW5ncy5tYXAoKHJvdykgPT4gYCR7cm93LnN0YXR1c31cXHQke3Jvdy5uYW1lfVxcdCR7cm93LnBhdGh9XFx0JHtyb3cuc3RhcnR9XFx0JHtyb3cuZW5kfWApLnNvcnQoKTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHsgZmluZGluZ3M6IGZpbmRpbmdLZXlzLCB1bmNvdmVyZWQ6IFsuLi51bmNvdmVyZWRdLnNvcnQoKSB9KTtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgYWxyZWFkeSBiZWVuIGV4cGxhaW5lZCB0byB0aGUgYWdlbnQgaW5cbiAqIGZ1bGwgXHUyMDE0IG9ydGhvZ29uYWwgdG8gKGFuZCBpbmRlcGVuZGVudCBvZikgdGhlIGVuZm9yY2Utb25seSBjb25zaWRlci1vbmNlXG4gKiBkZW55IGNyZWRpdCBgZXZhbHVhdGVHYXRlYCByZWFkcy93cml0ZXMgb24gdGhlIHNhbWUgYGRpZ2VzdGAgdmFsdWUuIEEgc2luZ2xlXG4gKiBgZ2l0IHN0YXR1c2AvYGdpdCBhZGRgIHByZXZpZXcgYW5kIHRoZSBgZ2l0IGNvbW1pdGAvYHB1c2hgIHRoYXQgZm9sbG93cyBpdFxuICogbW9tZW50cyBsYXRlciByZXNvbHZlIHRvIHRoZSBzYW1lIGRpZ2VzdCBidXQgcmVhY2ggYGV2YWx1YXRlR2F0ZWAgdGhyb3VnaFxuICogZGlmZmVyZW50IG1vZGVzIChgJ2luZm9ybSdgIG5ldmVyIHRvdWNoZXMgdGhlIGRlbnkgY3JlZGl0KTsgd2l0aG91dCBhXG4gKiBzZXBhcmF0ZSBcInNlZW5cIiBheGlzLCBib3RoIHdvdWxkIHJlbmRlciB0aGUgaWRlbnRpY2FsIGNoZWNrbGlzdCB2ZXJiYXRpbSBpblxuICogdGhlIHNhbWUgdHVybiBcdTIwMTQgd2hpY2ggaXMgZXhhY3RseSB3aGF0IGEgY2FwdHVyZWQgc2Vzc2lvbiBzaG93ZWQ6IGEgc3RhdHVzXG4gKiBwcmV2aWV3IGltbWVkaWF0ZWx5IGZvbGxvd2VkIGJ5IGEgY29tbWl0IGF0dGVtcHQgb24gdGhlIHNhbWUgdHdvIGZpbGVzLFxuICogdGhlIHNlY29uZCBtZXNzYWdlIGRpZmZlcmluZyBvbmx5IGJ5IHRoZSBhcHBlbmRlZCByZXRyeSBzZW50ZW5jZS4gTWFya2luZ1xuICogXCJzZWVuXCIgaGVyZSAoYW5kIGNvbnN1bHRpbmcgaXQgYmVmb3JlIHJlbmRlcmluZykgbGV0cyBib3RoIGByZW5kZXJTdGFsZW5lc3NSZWFzb25gXG4gKiBhbmQgYHJlbmRlclVuY292ZXJlZFJlYXNvbmAgZmFsbCBiYWNrIHRvIGEgY29uZGVuc2VkIHJlbWluZGVyIG9uIHRoZSBzZWNvbmRcbiAqIHNob3dpbmcsIGluIGVpdGhlciBkaXJlY3Rpb24gKGluZm9ybS10aGVuLWVuZm9yY2Ugb3IgZW5mb3JjZS10aGVuLWluZm9ybSksXG4gKiB3aXRob3V0IGNoYW5naW5nIHdoZXRoZXIgYGVuZm9yY2VgIGRlbmllcyBvciBhbGxvd3MuXG4gKi9cbmZ1bmN0aW9uIHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZSwgZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgc2VlbktleSA9IGBzZWVuLSR7ZGlnZXN0fWA7XG4gIGNvbnN0IGFscmVhZHkgPSBtZW1vU3RhdGUuaGFzKHNlZW5LZXkpO1xuICBtZW1vU3RhdGUucmVjb3JkKHNlZW5LZXkpO1xuICByZXR1cm4gYWxyZWFkeTtcbn1cblxuLyoqXG4gKiBGZXRjaCB0aGUgaHVtYW4tZm9ybWF0IGAjIyA8bmFtZT5gIGJsb2NrcyBmb3IgdGhlIHNwYW5zIG5hbWVkIGluIGByb3dzYCxcbiAqIGZhaWxpbmcgdG8gYCcnYCAobmV2ZXIgdGhyb3dpbmcpIHNvIGEgbGlzdCBmYWlsdXJlIGNhbiBuZXZlciB0dXJuIGEgZGVueVxuICogaW50byBhIHNpbGVudCBhbGxvdyB2aWEge0BsaW5rIGV2YWx1YXRlR2F0ZX0ncyBvdXRlciBjYXRjaCBcdTIwMTRcbiAqIHtAbGluayBhbm5vdGF0ZUJsb2Nrc30gc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MgZnJvbSB0aGUgcm93cyBpbnN0ZWFkLlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IG5hbWVzID0gWy4uLm5ldyBTZXQocm93cy5tYXAoKHJvdykgPT4gcm93Lm5hbWUpKV0uc29ydCgpO1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBleGVjdXRvcnMubGlzdEJsb2NrcyhuYW1lcywgY3dkKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgYW5jaG9yIGFkZHJlc3MgaW50byBvbmUgZW50cnksIGNvbWJpbmluZ1xuICogdGhlaXIgZGlzdGluY3Qgc3RhdHVzZXMgKHNvcnRlZCkgYW5kIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gVGhlIENMSSdzXG4gKiBgc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBvbmUgcm93IHBlciAqZHJpZnRpbmcgbGF5ZXIqIGZvciBhIHNpbmdsZVxuICogYW5jaG9yIChlLmcuIGJvdGggd29ya3RyZWUgYW5kIGluZGV4IGNoYW5nZWQpIFx1MjAxNCBhIGRpc3RpbmN0aW9uIHRoZSBgc3JjYFxuICogY29sdW1uIGNhcnJpZXMgYnV0IHtAbGluayBwYXJzZVN0YWxlUG9yY2VsYWlufSBkZWxpYmVyYXRlbHkgZHJvcHMgXHUyMDE0IHNvXG4gKiB3aXRob3V0IHRoaXMgY29sbGFwc2UgdGhlIHNhbWUgYW5jaG9yIHdvdWxkIG90aGVyd2lzZSByZW5kZXIgYXMgdHdvIChvclxuICogbW9yZSkgaWRlbnRpY2FsIGJ1bGxldHMgaW5zdGVhZCBvZiBvbmUgYnVsbGV0IHdpdGggZXZlcnkgc3RhdHVzIGl0IGVhcm5lZC5cbiAqL1xuZnVuY3Rpb24gZGVkdXBlQnlBbmNob3Iocm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHsgYWRkcjogc3RyaW5nOyBzdGF0dXNlczogUG9yY2VsYWluU3RhdHVzW10gfVtdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5QWRkciA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8UG9yY2VsYWluU3RhdHVzPj4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGFkZHIgPSBhbmNob3JUZXh0KHJvdyk7XG4gICAgbGV0IHN0YXR1c2VzID0gYnlBZGRyLmdldChhZGRyKTtcbiAgICBpZiAoIXN0YXR1c2VzKSB7XG4gICAgICBzdGF0dXNlcyA9IG5ldyBTZXQoKTtcbiAgICAgIGJ5QWRkci5zZXQoYWRkciwgc3RhdHVzZXMpO1xuICAgICAgb3JkZXIucHVzaChhZGRyKTtcbiAgICB9XG4gICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKGFkZHIpID0+ICh7IGFkZHIsIHN0YXR1c2VzOiBbLi4uKGJ5QWRkci5nZXQoYWRkcikgPz8gW10pXS5zb3J0KCkgfSkpO1xufVxuXG4vKipcbiAqIEFubm90YXRlIGBnaXQgc3BhbiBsaXN0YCBodW1hbiBibG9ja3Mgd2l0aCBwZXItYW5jaG9yIGRyaWZ0IGxhYmVsczogZWFjaFxuICogYnVsbGV0IHdob3NlIGFuY2hvciBtYXRjaGVzIGEgZmluZGluZyBnYWlucyBgIFx1MjAxNCA8bGFiZWw+YC4gQnVsbGV0cyBhcmUgb25seVxuICogdGhlIGNvbnRpZ3VvdXMgYC0gYCBydW4gZGlyZWN0bHkgdW5kZXIgYSBgIyMgPG5hbWU+YCBoZWFkZXIsIHNvIGFcbiAqIGRlc2NyaXB0aW9uIGxpbmUgdGhhdCBoYXBwZW5zIHRvIHN0YXJ0IHdpdGggYC0gYCBpcyBuZXZlciBhbm5vdGF0ZWQuXG4gKiBGaW5kaW5ncyB3aG9zZSBhbmNob3IgaGFzIG5vIG1hdGNoaW5nIGJ1bGxldCBhcmUgYXBwZW5kZWQgdG8gdGhlaXIgc3BhbidzXG4gKiBidWxsZXQgcnVuOyBzcGFucyBhYnNlbnQgZnJvbSBgYmxvY2tzVGV4dGAgZW50aXJlbHkgKG9yIGFuIGVtcHR5L2ZhaWxlZFxuICogbGlzdCByZWFkKSBnZXQgYSBzeW50aGVzaXplZCBtaW5pbWFsIGJsb2NrIFx1MjAxNCBubyBmaW5kaW5nIGlzIGV2ZXIgZHJvcHBlZC5cbiAqIEV2ZXJ5IGZpbmRpbmcgbWF0Y2hpbmcgKG9yIGFwcGVuZGVkIGZvcikgYSBnaXZlbiBhbmNob3IgYWRkcmVzcyBpc1xuICogY29sbGFwc2VkIHZpYSB7QGxpbmsgZGVkdXBlQnlBbmNob3J9IGZpcnN0LCBzbyBhIHNpbmdsZSBhbmNob3IgbmV2ZXJcbiAqIHJlbmRlcnMgYXMgbW9yZSB0aGFuIG9uZSBidWxsZXQgcmVnYXJkbGVzcyBvZiBob3cgbWFueSBkcmlmdGluZy1sYXllciByb3dzXG4gKiB0aGUgQ0xJIGVtaXR0ZWQgZm9yIGl0LlxuICovXG5mdW5jdGlvbiBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0OiBzdHJpbmcsIHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10pOiBzdHJpbmcge1xuICBjb25zdCByZW1haW5pbmcgPSBuZXcgTWFwPHN0cmluZywgU3RhbGVQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGdyb3VwID0gcmVtYWluaW5nLmdldChyb3cubmFtZSk7XG4gICAgaWYgKGdyb3VwKSBncm91cC5wdXNoKHJvdyk7XG4gICAgZWxzZSByZW1haW5pbmcuc2V0KHJvdy5uYW1lLCBbcm93XSk7XG4gIH1cblxuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGxldCBwZW5kaW5nOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGxldCBpbkJ1bGxldHMgPSBmYWxzZTtcbiAgY29uc3QgY2xvc2VCdWxsZXRzID0gKCk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3QgeyBhZGRyLCBzdGF0dXNlcyB9IG9mIGRlZHVwZUJ5QW5jaG9yKHBlbmRpbmcpKSB7XG4gICAgICBvdXQucHVzaChgLSAke2FkZHJ9IFx1MjAxNCAke3N0YXR1c2VzLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWApO1xuICAgIH1cbiAgICBwZW5kaW5nID0gW107XG4gICAgaW5CdWxsZXRzID0gZmFsc2U7XG4gIH07XG5cbiAgY29uc3QgdHJpbW1lZCA9IGJsb2Nrc1RleHQudHJpbSgpO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBsaW5lIG9mIHRyaW1tZWQuc3BsaXQoJ1xcbicpKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSAvXiMjICguKykkLy5leGVjKGxpbmUpO1xuICAgICAgaWYgKGhlYWRlcikge1xuICAgICAgICBjbG9zZUJ1bGxldHMoKTtcbiAgICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICAgIHBlbmRpbmcgPSByZW1haW5pbmcuZ2V0KGhlYWRlclsxXSkgPz8gW107XG4gICAgICAgIHJlbWFpbmluZy5kZWxldGUoaGVhZGVyWzFdKTtcbiAgICAgICAgaW5CdWxsZXRzID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaW5CdWxsZXRzICYmIGxpbmUuc3RhcnRzV2l0aCgnLSAnKSkge1xuICAgICAgICBjb25zdCBhZGRyID0gbGluZS5zbGljZSgyKTtcbiAgICAgICAgY29uc3QgZXhhY3QgPSBwZW5kaW5nLmZpbHRlcigocm93KSA9PiBhbmNob3JUZXh0KHJvdykgPT09IGFkZHIpO1xuICAgICAgICBjb25zdCBtYXRjaGVkID1cbiAgICAgICAgICBleGFjdC5sZW5ndGggPiAwID8gZXhhY3QgOiBwZW5kaW5nLmZpbHRlcigocm93KSA9PiBhZGRyID09PSByb3cucGF0aCB8fCBhZGRyLnN0YXJ0c1dpdGgoYCR7cm93LnBhdGh9I2ApKTtcbiAgICAgICAgaWYgKG1hdGNoZWQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1hdGNoZWRTZXQgPSBuZXcgU2V0KG1hdGNoZWQpO1xuICAgICAgICAgIHBlbmRpbmcgPSBwZW5kaW5nLmZpbHRlcigocm93KSA9PiAhbWF0Y2hlZFNldC5oYXMocm93KSk7XG4gICAgICAgICAgY29uc3Qgc3RhdHVzZXMgPSBbLi4ubmV3IFNldChtYXRjaGVkLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICAgICAgICBvdXQucHVzaChgJHtsaW5lfSBcdTIwMTQgJHtzdGF0dXNlcy5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvdXQucHVzaChsaW5lKTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpbkJ1bGxldHMpIGNsb3NlQnVsbGV0cygpO1xuICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgfVxuICAgIGNsb3NlQnVsbGV0cygpO1xuICB9XG5cbiAgZm9yIChjb25zdCBbbmFtZSwgZ3JvdXBdIG9mIHJlbWFpbmluZykge1xuICAgIGlmIChvdXQubGVuZ3RoID4gMCkgb3V0LnB1c2goJycsICctLS0nLCAnJyk7XG4gICAgb3V0LnB1c2goYCMjICR7bmFtZX1gKTtcbiAgICBmb3IgKGNvbnN0IHsgYWRkciwgc3RhdHVzZXMgfSBvZiBkZWR1cGVCeUFuY2hvcihncm91cCkpIHtcbiAgICAgIG91dC5wdXNoKGAtICR7YWRkcn0gXHUyMDE0ICR7c3RhdHVzZXMubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dC5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgZnVsbC1zcGFuIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBgZGVueWAgKG9yLCBpbiBgJ2luZm9ybSdgIG1vZGUsXG4gKiBhIGBzdGF0dXNgIGFkdmlzb3J5KSByZW5kZXJzIGludG8gYHJlYXNvbmAuIFRoZSBjbG9zaW5nIHNlbnRlbmNlIGRyb3BzIFwiXHUyMDE0XG4gKiB0aGVuIHJldHJ5XCIgaW4gYCdpbmZvcm0nYCBtb2RlOiBhIGBzdGF0dXNgIGNoZWNrIG5ldmVyIGhlbGQgYW55dGhpbmcsIHNvXG4gKiB0aGVyZSBpcyBub3RoaW5nIHRvIHJldHJ5LlxuICovXG5mdW5jdGlvbiByZW5kZXJTdGFsZW5lc3NSZWFzb24oXG4gIGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLFxuICBibG9ja3NUZXh0OiBzdHJpbmcsXG4gIG1vZGU6IEdhdGVNb2RlID0gJ2VuZm9yY2UnLFxuICBhbHJlYWR5U2VlbiA9IGZhbHNlXG4pOiBzdHJpbmcge1xuICBjb25zdCBuYW1lcyA9IFsuLi5uZXcgU2V0KGZpbmRpbmdzLm1hcCgocm93KSA9PiByb3cubmFtZSkpXTtcbiAgY29uc3Qgc3ViamVjdCA9IG5hbWVzLmxlbmd0aCA9PT0gMSA/ICdhbiBpbXBsaWNpdCBkZXBlbmRlbmN5JyA6ICdpbXBsaWNpdCBkZXBlbmRlbmNpZXMnO1xuICBjb25zdCBuYW1lID0gbmFtZXMubGVuZ3RoID09PSAxID8gbmFtZXNbMF0gOiAnPG5hbWU+JztcbiAgY29uc3QgYWN0aW9uID0gYFxcYGdpdCBzcGFuIGFkZCAke25hbWV9IDxwYXRoI0xzdGFydC1MZW5kPlxcYCAvIFxcYGdpdCBzcGFuIHdoeSAke25hbWV9IFwiLi4uXCJcXGBgO1xuICBpZiAoYWxyZWFkeVNlZW4pIHtcbiAgICBjb25zdCBwYXRocyA9IFsuLi5uZXcgU2V0KGZpbmRpbmdzLm1hcCgocm93KSA9PiByb3cucGF0aCkpXTtcbiAgICBjb25zdCBjbG9zaW5nID1cbiAgICAgIG1vZGUgPT09ICdlbmZvcmNlJ1xuICAgICAgICA/IGBBbHJlYWR5IGZsYWdnZWQgYWJvdmUgXHUyMDE0IHVwZGF0ZSB0aGUgZHJpZnRlZCBsb2NhdGlvbnMgb3IgdGhlIGRlc2NyaXB0aW9uLCB0aGVuIHJldHJ5LmBcbiAgICAgICAgOiBgQWxyZWFkeSBmbGFnZ2VkIGFib3ZlIFx1MjAxNCB1cGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbi5gO1xuICAgIHJldHVybiBbYFRoaXMgY2hhbmdlIHN0aWxsIGxlYXZlcyAke3N1YmplY3R9IG91dCBvZiBkYXRlOmAsIC4uLnBhdGhzLm1hcCgocGF0aCkgPT4gYC0gJHtwYXRofWApLCAnJywgY2xvc2luZ10uam9pbihcbiAgICAgICdcXG4nXG4gICAgKTtcbiAgfVxuICBjb25zdCBjbG9zaW5nID1cbiAgICBtb2RlID09PSAnZW5mb3JjZSdcbiAgICAgID8gYFVwZGF0ZSB0aGUgZHJpZnRlZCBsb2NhdGlvbnMgb3IgdGhlIGRlc2NyaXB0aW9uIFx1MjAxNCAke2FjdGlvbn0gXHUyMDE0IHRoZW4gcmV0cnkuIElmIGEgZGVwZW5kZW5jeSBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC5gXG4gICAgICA6IGBVcGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiBcdTIwMTQgJHthY3Rpb259LiBJZiBhIGRlcGVuZGVuY3kgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuYDtcbiAgcmV0dXJuIFtcbiAgICBgVGhpcyBjaGFuZ2UgbGVhdmVzICR7c3ViamVjdH0gb3V0IG9mIGRhdGU6YCxcbiAgICAnJyxcbiAgICBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0LCBmaW5kaW5ncyksXG4gICAgJycsXG4gICAgJy0tLScsXG4gICAgJycsXG4gICAgY2xvc2luZ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFdyYXAgYHRleHRgIGZvciBkZWxpdmVyeSBhcyBhIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLCBzbyBldmVyeSBzdWNoXG4gKiBwYXlsb2FkIHRoaXMgZ2F0ZSBlbWl0cyBzaXRzIGluc2lkZSBhIGA8Z2l0LXNwYW4+Li4uPC9naXQtc3Bhbj5gIGJsb2NrIFx1MjAxNFxuICogbWF0Y2hpbmcgdGhlIHRvdWNoIGhvb2sncyBibG9jayBzdHlsaW5nIFx1MjAxNCBuZXZlciBiYXJlIHByb3NlLiBBIG5vLW9wIHdoZW5cbiAqIGB0ZXh0YCBhbHJlYWR5IGNhcnJpZXMgYSBgPGdpdC1zcGFuPmAgdGFnIHNvbWV3aGVyZSAoZS5nLlxuICoge0BsaW5rIHJlbmRlclVuY292ZXJlZFJlYXNvbn0ncyBvdXRwdXQgYWxyZWFkeSB3cmFwcyBpdHNlbGYpLCBzbyBhIGNhbGxlclxuICogY2FuIGFwcGx5IHRoaXMgdW5jb25kaXRpb25hbGx5IHdpdGhvdXQgZXZlciBuZXN0aW5nIG9uZSBibG9jayBpbnNpZGVcbiAqIGFub3RoZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3cmFwR2l0U3BhbkNvbnRleHQodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHRleHQuaW5jbHVkZXMoJzxnaXQtc3Bhbj4nKSkgcmV0dXJuIHRleHQ7XG4gIHJldHVybiBgPGdpdC1zcGFuPlxcbiR7dGV4dH1cXG48L2dpdC1zcGFuPmA7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IHN1cmZhY2VkIHdoZW4gdGhlIGNoYW5nZXNldCdzIG9ubHkgc3RhbGVuZXNzIGlzIGVudmlyb25tZW50YWwgXHUyMDE0XG4gKiB0aGUgZ2F0ZSBhbGxvd3MgYnV0IHNheXMgd2h5LCBzbyB0aGUgdW5yZXNvbHZhYmxlIGNvbmRpdGlvbiBpcyBub3Qgc2lsZW50bHlcbiAqIHN3YWxsb3dlZC5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRW52aXJvbm1lbnRhbFJlYXNvbihjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdLCBibG9ja3NUZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgICdDb3VsZCBub3QgY2hlY2sgdGhlc2UgaW1wbGljaXQgZGVwZW5kZW5jaWVzICh1bmZldGNoZWQgTEZTLCBzcGFyc2UgY2hlY2tvdXQsIG9yIHNpbWlsYXIpIFx1MjAxNCBub3QgYmxvY2tpbmc6JyxcbiAgICAnJyxcbiAgICBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0LCBjb25kaXRpb25zKSxcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICAnRml4IHRoZSBjaGVja291dC9mZXRjaCBpc3N1ZSBpZiB0aGVzZSBkZXBlbmRlbmNpZXMgbmVlZCB2ZXJpZnlpbmcuJ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBhbiBgYWxsb3dgL2BzY2FuLWZhaWxlZGAgcmVzdWx0IHJlbmRlcnMgaW50byBgcmVhc29uYDogdGhlIHNjYW5cbiAqIGNvdWxkIG5vdCBjb21wbGV0ZSwgc28gdGhlIGNoYW5nZXNldCB3YXMgTk9UIHZlcmlmaWVkIFx1MjAxNCBidXQgdGhlIGNvbW1hbmRcbiAqIHByb2NlZWRzIGFueXdheSAoZmFpbC1vcGVuLCBtYXRjaGluZyBgZW52aXJvbm1lbnRhbGApLlxuICovXG5mdW5jdGlvbiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGRldGFpbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICAnVGhlIGltcGxpY2l0LWRlcGVuZGVuY3kgY2hlY2sgY291bGQgbm90IHJ1biwgc28gdGhpcyBjaGFuZ2Ugd2FzIE5PVCB2ZXJpZmllZDonLFxuICAgIGAgICR7ZGV0YWlsfWAsXG4gICAgJycsXG4gICAgJ1RoZSBjb21tYW5kIHByb2NlZWRzIGFueXdheS4gRml4IHRoZSBzY2FuIGVycm9yIGlmIHZlcmlmaWNhdGlvbiBtYXR0ZXJzIGZvciB0aGlzIGNoYW5nZS4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGxpc3QgYW4gdW5jb3ZlcmVkLXdyaXRlcyBgZGVueWAgKG9yLCBpbiBgJ2luZm9ybSdgIG1vZGUsIGEgYHN0YXR1c2BcbiAqIGFkdmlzb3J5KSByZW5kZXJzIGludG8gYHJlYXNvbmAsIHdyYXBwZWQgaW4gYSBgPGdpdC1zcGFuPmAgYmxvY2sgbWF0Y2hpbmcgdGhlXG4gKiB0b3VjaCBob29rJ3MgYmxvY2sgc3R5bGluZy4gVGhlIFwicmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAob25lLXRpbWVcbiAqIGNoZWNrKVwiIHNlbnRlbmNlIGRyb3BzIGVudGlyZWx5IGluIGAnaW5mb3JtJ2AgbW9kZTogYSBgc3RhdHVzYCBjaGVjayBuZXZlclxuICogaGVsZCBhbnl0aGluZywgc28gdGhlcmUgaXMgbm90aGluZyB0byByZXRyeSBhbmQgbm8gY29uc2lkZXItb25jZSBzdGF0ZSB0b1xuICogY2xlYXIuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQ6IHN0cmluZ1tdLCBtb2RlOiBHYXRlTW9kZSA9ICdlbmZvcmNlJywgYWxyZWFkeVNlZW4gPSBmYWxzZSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gdW5jb3ZlcmVkLm1hcCgocGF0aCkgPT4gYC0gJHtwYXRofWApO1xuICBpZiAoYWxyZWFkeVNlZW4pIHtcbiAgICBjb25zdCBib2R5ID0gWyc8Z2l0LXNwYW4+JywgLi4ubGluZXMsICcnLCAnQWxyZWFkeSBmbGFnZ2VkIGZvciBnaXQtc3BhbiByZXZpZXcgYWJvdmUuJ107XG4gICAgaWYgKG1vZGUgPT09ICdlbmZvcmNlJykge1xuICAgICAgYm9keS5wdXNoKCcnLCAnSWYgbm9uZSBleGlzdCwgcmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAob25lLXRpbWUgY2hlY2spLicpO1xuICAgIH1cbiAgICBib2R5LnB1c2goJzwvZ2l0LXNwYW4+Jyk7XG4gICAgcmV0dXJuIGJvZHkuam9pbignXFxuJyk7XG4gIH1cbiAgY29uc3QgYm9keSA9IFtcbiAgICAnPGdpdC1zcGFuPicsXG4gICAgLi4ubGluZXMsXG4gICAgJycsXG4gICAgJ0RldGVybWluZSBpZiB0aGVzZSBmaWxlcyBjYXJyeSBpbXBsaWNpdCBkZXBlbmRlbmNpZXMsIHRoZW4gdXNlIGBnaXQgc3BhbmAgdG8gZG9jdW1lbnQgdGhlbTonLFxuICAgICcnLFxuICAgICdgZ2l0IHNwYW4gYWRkIDxuYW1lPiA8cGF0aCNMc3RhcnQtTGVuZD4gWzxwYXRoI0xzdGFydC1MZW5kPl0gLi4uYCcsXG4gICAgJ2BnaXQgc3BhbiB3aHkgPG5hbWU+IFwiPHdoeT5cImAnLFxuICAgICcnLFxuICAgICdUaGUgXCI8d2h5PlwiIGlzIGEgc2luZ2xlIHByZXNlbnQtdGVuc2Ugc2VudGVuY2UgbmFtaW5nIHdoYXQgdGhlIHJhbmdlcyBmb3JtIHRvZ2V0aGVyLCBzcGVjaWZpYyBlbm91Z2ggdG8gdGVsbCB3aGV0aGVyIGFuIGVkaXQgbGFuZHMgaW5zaWRlIGl0LCB3aXRoIG5vIHJ1bGVzIG9yIHJlbWluZGVycy4nXG4gIF07XG4gIGlmIChtb2RlID09PSAnZW5mb3JjZScpIHtcbiAgICBib2R5LnB1c2goJycsICdJZiBub25lIGV4aXN0LCByZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZSBjaGVjaykuJyk7XG4gIH1cbiAgYm9keS5wdXNoKCcnLCAnTG9hZCB0aGUgYGdpdC1zcGFuOmdpdC1zcGFuYCBza2lsbCBmb3IgZ3VpZGFuY2UuJywgJzwvZ2l0LXNwYW4+Jyk7XG4gIHJldHVybiBib2R5LmpvaW4oJ1xcbicpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy9kaXNrLWJhY2tlZCBkZXBlbmRlbmNpZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy9cbi8vIFRoZSBwcm9kdWN0aW9uIHN1cmZhY2VzIGJvdGggYWRhcHRlcnMgaW5qZWN0IGJ5IGRlZmF1bHQsIGZvbGxvd2luZ1xuLy8gdG91Y2gtY29yZS50cydzIGBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnNgIHN0eWxlOiBlYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuXG4vLyBvbiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuLy8gbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgbm8gcmVwbykgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0IHNvXG4vLyB0aGUgZ2F0ZSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcyB3aXRob3V0IHRoZSBhZGFwdGVyIGFkZGluZyBpdHMgb3duLlxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSdW4gYSBnaXQgY29tbWFuZCBhdCBgY3dkYCwgcmV0dXJuaW5nIHRyaW1tZWQgbm9uLWVtcHR5IFBPU0lYIG91dHB1dCBsaW5lcyAoZW1wdHkgb24gYW55IGZhaWx1cmUpLiAqL1xuZnVuY3Rpb24gZ2l0TGluZXMoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKlxuICogTGlrZSB7QGxpbmsgZ2l0TGluZXN9IGJ1dCBkaXN0aW5ndWlzaGVzIGEgKmZhaWxlZCogaW52b2NhdGlvbiAoYG51bGxgIFx1MjAxNCBlLmcuXG4gKiBgQHt1fWAgd2l0aCBubyB1cHN0cmVhbSBjb25maWd1cmVkKSBmcm9tIGEgKnN1Y2Nlc3NmdWwgYnV0IGVtcHR5KiByZXN1bHRcbiAqIChgW11gKSwgc28gdGhlIG91dGdvaW5nLXJhbmdlIHJlc29sdXRpb24ga25vd3Mgd2hlbiB0byB0cnkgdGhlIG1lcmdlLWJhc2VcbiAqIGZhbGxiYWNrIHJhdGhlciB0aGFuIG1pc3Rha2luZyBcIm5vIHVwc3RyZWFtXCIgZm9yIFwibm90aGluZyB0byBwdXNoXCIuXG4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzT3JOdWxsKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gICAgcmV0dXJuIG91dFxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lLmxlbmd0aCA+IDApXG4gICAgICAubWFwKHRvUG9zaXgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdpdEV4ZWN1dG9yfTogYGdpdCBkaWZmYCByZWFkcyBzY29wZWQgdG8gdGhlIENXRCByZXBvLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcih0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdpdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIHtcbiAgICBzdGFnZWRQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tY2FjaGVkJywgJy0tbmFtZS1vbmx5J10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgdHJhY2tlZE1vZGlmaWVkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIG91dGdvaW5nUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICBjb25zdCB1cHN0cmVhbSA9IGdpdExpbmVzT3JOdWxsKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknLCAnQHt1fS4uSEVBRCddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICAgIGlmICh1cHN0cmVhbSAhPT0gbnVsbCkgcmV0dXJuIHVwc3RyZWFtO1xuICAgICAgLy8gTm8gdXBzdHJlYW0gY29uZmlndXJlZDogZmFsbCBiYWNrIHRvIHRoZSBtZXJnZS1iYXNlIHdpdGggdGhlIGRlZmF1bHRcbiAgICAgIC8vIHJlbW90ZSBicmFuY2ggKGBvcmlnaW4vSEVBRGApLiBJZiB0aGF0IHRvbyBpcyB1bnJlc29sdmFibGUsIGZhaWwgb3Blbi5cbiAgICAgIGNvbnN0IGJhc2UgPSBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdtZXJnZS1iYXNlJywgJ0hFQUQnLCAnb3JpZ2luL0hFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcylbMF07XG4gICAgICBpZiAoIWJhc2UpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgYCR7YmFzZX0uLkhFQURgXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBwYXRoc3BlY1BhdGhzOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICAvLyBXb3JraW5nLXRyZWUgY29udGVudCB2cyBIRUFELCBzY29wZWQgdG8gdGhlIHBhdGhzcGVjcyBcdTIwMTQgdGhlIGZpbGVzIGFcbiAgICAgIC8vIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5gIHdvdWxkIGFjdHVhbGx5IGNoYW5nZSAoc3RhZ2VkIG9yIG5vdCkuXG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICdIRUFEJywgJy0tbmFtZS1vbmx5JywgJy0tJywgLi4ucGF0aHNdLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9XG4gIH07XG59XG5cbi8qKiBUaGUgcHJvZHVjdGlvbiB7QGxpbmsgR2F0ZUV4ZWN1dG9yc306IHNjb3BlZCBgZ2l0IHNwYW5gIGZpeC9zdGFsZS9saXN0IGF0IHRoZSByZXBvIHJvb3QuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHYXRlRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgLi4ucGF0aHMsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gYWZ0ZXIgaGVhbGluZywgYW5kIG5vbi16ZXJvIG9uXG4gICAgICAgIC8vIGdlbnVpbmUgZmFpbHVyZTsgZWl0aGVyIHdheSB0aGUgc3Vic2VxdWVudCBgc3RhbGVgIHJlYWQgaXMgdGhlIHNvdXJjZVxuICAgICAgICAvLyBvZiB0cnV0aCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgfSxcbiAgICBzdGFsZTogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyBub24temVybyBpbiB0d28gdmVyeSBkaWZmZXJlbnQgd2F5cywgYW5kIHRoZXlcbiAgICAgICAgLy8gbXVzdCBub3QgYmUgY29uZmxhdGVkOlxuICAgICAgICAvLyAgLSBMZWdpdGltYXRlIGRyaWZ0OiByZWFsIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCBkZXNjcmliaW5nIHRoZVxuICAgICAgICAvLyAgICBkcmlmdC4gUGFyc2UgdGhlbSAodGhpcyBpcyB0aGUgd2hvbGUgcG9pbnQgb2YgdGhlIHJlYWQpLlxuICAgICAgICAvLyAgLSBIYXJkIHNjYW4gZmFpbHVyZTogdGhlIHNjb3BlZCBxdWVyeSBhYm9ydGVkIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAgICAgIC8vICAgIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB3cml0aW5nIGFuIGVycm9yIHRvIHN0ZGVyciBhbmQgZW1pdHRpbmdcbiAgICAgICAgLy8gICAgZW1wdHkgc3Rkb3V0LiBBbiBlbXB0eSByZXN1bHQgaGVyZSBpcyBOT1QgXCJjbGVhblwiIFx1MjAxNCB0aGUgc2NhbiBuZXZlclxuICAgICAgICAvLyAgICByYW4gdG8gY29tcGxldGlvbiBcdTIwMTQgc28gc2lnbmFsIGl0IGRpc3RpbmN0bHkgcmF0aGVyIHRoYW4gcGFyc2luZyB0b1xuICAgICAgICAvLyAgICBgW11gLCB3aGljaCB3b3VsZCByZWFkIGFzIGEgY2xlYW4gcGFzcyBhbmQgc2lsZW50bHkgYWxsb3cgdGhlIGNvbW1pdC5cbiAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGNvbnN0IHN0ZGVyciA9IChlcnIgYXMgeyBzdGRlcnI/OiBzdHJpbmcgfSkuc3RkZXJyO1xuICAgICAgICBjb25zdCBzdGRvdXRUZXh0ID0gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiAnJztcbiAgICAgICAgY29uc3Qgc3RkZXJyVGV4dCA9IHR5cGVvZiBzdGRlcnIgPT09ICdzdHJpbmcnID8gc3RkZXJyIDogJyc7XG4gICAgICAgIGlmIChzdGRvdXRUZXh0LnRyaW0oKS5sZW5ndGggPT09IDAgJiYgc3RkZXJyVGV4dC50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBHYXRlU2NhbkVycm9yKHN0ZGVyclRleHQudHJpbSgpKTtcbiAgICAgICAgfVxuICAgICAgICBvdXQgPSBzdGRvdXRUZXh0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuICAgIGxpc3Q6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG4gICAgbGlzdEJsb2NrczogYXN5bmMgKG5hbWVzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IG5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAuLi5uYW1lc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBIGZhaWxlZCBodW1hbi1mb3JtYXQgcmVhZCBvbmx5IGRlZ3JhZGVzIHRoZSByZW5kZXJlZCBtZXNzYWdlXG4gICAgICAgIC8vIChhbm5vdGF0ZUJsb2NrcyBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2Nrcyk7IG5ldmVyIGEgZ2F0ZSBlcnJvci5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBkaXNrLWJhY2tlZCB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX06IG9uZSBtYXJrZXIgZmlsZSBwZXIgZGVidC1zdGF0ZVxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgZmlsZS1iYWNrZWQgYE1lbW9TdG9yZWAgcGF0dGVybi4gVGhlIGRpZ2VzdCBpcyBhIGhleCBzaGEyNTYsXG4gKiBhIHNhZmUgZmlsZW5hbWUuIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGEgbWVtbyB3aG9zZSByZXBvIGNhbm5vdCBiZVxuICogcmVzb2x2ZWQgZGVncmFkZXMgdG8gYSBuby1vcCBzdG9yZSAobmV2ZXIgcGVyc2lzdHMgXHUyMTkyIHVuY292ZXJlZCB3b3VsZCByZS1kZW55LFxuICogYnV0IGFuIHVucmVzb2x2YWJsZSByZXBvIHlpZWxkcyBhbiBlbXB0eSBjaGFuZ2VzZXQgdXBzdHJlYW0gYW55d2F5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlKGN3ZDogc3RyaW5nKTogR2F0ZU1lbW9TdGF0ZSB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHtcbiAgICAvLyBObyByZXNvbHZhYmxlIHJlcG8gXHUyMTkyIHRoZSBtZW1vIGNhbm5vdCBwZXJzaXN0LiBSZXBvcnQgYGZhbHNlYCBmcm9tXG4gICAgLy8gYHJlY29yZGAgc28gdGhlIGdhdGUgZmFpbHMgb3BlbiByYXRoZXIgdGhhbiBkZW55aW5nIHdpdGggbm8gZXNjYXBlLlxuICAgIHJldHVybiB7IGhhczogKCkgPT4gZmFsc2UsIHJlY29yZDogKCkgPT4gZmFsc2UgfTtcbiAgfVxuICBjb25zdCBkaXIgPSBnYXRlTWVtb0RpcihyZXBvUm9vdCk7XG4gIHJldHVybiB7XG4gICAgaGFzOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gZnMuZXhpc3RzU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sXG4gICAgcmVjb3JkOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSwgJycpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBIGZhaWxlZCBtZW1vIHdyaXRlIG11c3QgbmV2ZXIgYnJpY2sgdGhlIGNvbW1pdCBhbmQgbXVzdCBuZXZlclxuICAgICAgICAvLyBzaWxlbnRseSByZS1kZW55IGZvcmV2ZXI6IHJlcG9ydCB0aGUgZmFpbHVyZSBzbyB0aGUgZ2F0ZSBmYWlscyBvcGVuLlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlU3RhbGVQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWxlUG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBnYXRlLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGdhdGUncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGdhdGUgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGdhdGUgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBnYXRlIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgZ2F0ZSBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN0YWxlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogU3RhbGVQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBnYXRlJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2F0ZU1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdnYXRlJyk7XG59XG4iLCAiLyoqXG4gKiBQYXRoIGV4Y2x1c2lvbiBsaXN0IGZvciB0aGUgZ2F0ZSdzIHVuY292ZXJlZC13cml0ZXMgY2hlY2suXG4gKlxuICogYGV2YWx1YXRlR2F0ZWAgaW4ge0BsaW5rIGZpbGU6Ly8uL2dhdGUtY29yZS50c30gYWxyZWFkeSBleGNsdWRlcyBgLnNwYW4vKipgXG4gKiBwYXRocyBmcm9tIGl0cyB1bmNvdmVyZWQtd3JpdGVzIGNvbXB1dGF0aW9uIHVuY29uZGl0aW9uYWxseSAoc3BhbiByZXBhaXJzXG4gKiByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpLiBUaGlzIG1vZHVsZVxuICogYWRkcyBhIHNlY29uZCwgdXNlci1kZWNsYXJlZCBleGNsdXNpb24gc291cmNlIG9uIHRvcCBvZiB0aGF0OiBhIHJlcG8gb3duZXJcbiAqIGNhbiBsaXN0IGFkZGl0aW9uYWwgcGF0aHMgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2hvdWxkIG5ldmVyIGZsYWcgXHUyMDE0XG4gKiBnZW5lcmF0ZWQgb3V0cHV0LCB2ZW5kb3JlZCBjb2RlLCBhbnl0aGluZyB0aGF0IHdpbGwgbmV2ZXIgZ2V0IGEgc3Bhbi5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmdhdGVpZ25vcmVgLiBVbmxpa2VcbiAqIHtAbGluayBmaWxlOi8vLi9zcGFuLWlnbm9yZS50c30ncyBgLnNwYW4vLmhvb2tpZ25vcmVgIFx1MjAxNCB3aGljaCB0aGUgYGdpdC1zcGFuYFxuICogUnVzdCBDTEkgYXV0by1jcmVhdGVzIHdpdGggY2Fub25pY2FsIGNvbnRlbnQgXHUyMDE0IGAuZ2F0ZWlnbm9yZWAgaXNcbiAqICoqdXNlci1vd25lZCoqOiBub3RoaW5nIGNyZWF0ZXMgb3IgcG9wdWxhdGVzIGl0LCBzbyBpdHMgYWJzZW5jZSBpcyB0aGVcbiAqIG5vcm1hbCwgdW5jb25maWd1cmVkIHN0YXRlLCBub3QgYSBicm9rZW4gb25lLlxuICpcbiAqIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuIChubyB0cmFpbGluZ1xuICogcHJlZml4IGxpc3QgXHUyMDE0IGEgYC5nYXRlaWdub3JlYCBsaW5lIGVpdGhlciBleGNsdWRlcyBhIHBhdGggZnJvbSB0aGVcbiAqIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgb3IgaXQgZG9lc24ndCwgdW5saWtlIGAuaG9va2lnbm9yZWAncyBwZXItc3Bhbi1zbHVnXG4gKiBzdXBwcmVzc2lvbik6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9nZW5lcmF0ZWQvKipcbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgaWRlbnRpY2FsIHRvIGAuaG9va2lnbm9yZWAncyAoc2VlIHRoYXQgbW9kdWxlJ3MgZG9jXG4gKiBjb21tZW50IGZvciB0aGUgZnVsbCBncmFtbWFyKSBhbmQgcmV1c2VzIGl0cyBjb21waWxlZCBtYXRjaGVyIHZpYVxuICoge0BsaW5rIGNvbXBpbGVQYXR0ZXJufSByYXRoZXIgdGhhbiByZWltcGxlbWVudGluZyBwYXRoIG1hdGNoaW5nOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBGYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuZ2F0ZWlnbm9yZWAsIG9yIGEgbWFsZm9ybWVkIGxpbmUsXG4gKiB5aWVsZHMgbm8gYWRkaXRpb25hbCBleGNsdXNpb24gXHUyMDE0IHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIHNpbXBseSBmYWxsc1xuICogYmFjayB0byB0aGUgYC5zcGFuLyoqYC1vbmx5IGV4Y2x1c2lvbiBpdCBhbHJlYWR5IGFwcGxpZXMuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY29tcGlsZVBhdHRlcm4gfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuZXhwb3J0IGludGVyZmFjZSBHYXRlSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZXhjbHVkZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgR0FURV9JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmdhdGVpZ25vcmUnKTtcblxuLyoqIFBhcnNlIGAuZ2F0ZWlnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgYmxhbmsgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHYXRlSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IEdhdGVJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogR2F0ZUlnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBwYXR0ZXJuID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFwYXR0ZXJuIHx8IHBhdHRlcm4uc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIGV4Y2x1c2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIGZhaWx1cmUgeWllbGRzIGFuXG4gKiBlbXB0eSBydWxlIHNldCwgc28gYW4gYWJzZW50L3VucmVhZGFibGUgYC5nYXRlaWdub3JlYCBleGNsdWRlcyBub3RoaW5nXG4gKiBiZXlvbmQgdGhlIGdhdGUncyB1bmNvbmRpdGlvbmFsIGAuc3Bhbi8qKmAgZXhjbHVzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IEdhdGVJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgR0FURV9JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VHYXRlSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIFRydWUgd2hlbiBzb21lIHJ1bGUgaW4gYHJ1bGVzYCBtYXRjaGVzIGByZXBvUmVsUGF0aGAuICovXG5leHBvcnQgZnVuY3Rpb24gaXNHYXRlSWdub3JlZChydWxlczogR2F0ZUlnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcnVsZXMuc29tZSgocnVsZSkgPT4gcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSk7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkR2F0ZUlnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgR2F0ZUlnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBHYXRlSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBuZWl0aGVyIGlubGluZSBieSB0aGUgUHJlVG9vbFVzZSBob29rXG4gKiBub3IgaW4gdGhlIFN0b3AgaG9vaydzIHN0YWxlIC8gcmVsYXRlZCBzZWN0aW9ucy5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5nYXRlaWdub3JlYFxuICogaW4gYGdhdGUtaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBDb2RleCBQcmVUb29sVXNlIGdhdGUgaG9vayBcdTIwMTQgaG9sZCBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYCBvbiByZWFsIHNwYW4gZGVidCxcbiAqIGFuZCBhZHZpc2UgKG5ldmVyIGhvbGQpIG9uIGEgcGxhaW4gYGdpdCBzdGF0dXNgLlxuICpcbiAqIFRoZSBDb2RleCB0d2luIG9mIFtjbGF1ZGUvZ2F0ZS50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY2xhdWRlL2dhdGUudHMpOlxuICogc2FtZSBzaGFyZWQgZ2F0ZS1jb3JlIHBpcGVsaW5lICh7QGxpbmsgcGFyc2VHaXRDb21tYW5kfSBcdTIxOTIge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9XG4gKiBcdTIxOTIge0BsaW5rIGV2YWx1YXRlR2F0ZX0pLCB0cmFuc2xhdGVkIGludG8gQ29kZXgncyBQcmVUb29sVXNlIG91dHB1dCBzaGFwZS4gQ29kZXhcbiAqIGRlbGl2ZXJzIGEgc2hlbGwgY29tbWFuZCBhcyBhbiBTREstdHlwZWQgYHVua25vd25gIGB0b29sX2lucHV0YDsgdGhpcyBoYW5kbGVyXG4gKiBuYXJyb3dzIGl0IChzdHJpbmcsIG9yIGEgYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gL2FyZ3YgYXJyYXkpIGludG8gdGhlXG4gKiBjb21tYW5kIHN0cmluZyB0aGUgY29yZSBwYXJzZXMuXG4gKlxuICogXHUyNTAwXHUyNTAwIFVuY29uZmlybWVkIGRlbnkgKHNlZSBub3Rlcy9jb2RleC1kZW55LXNwaWtlLm1kKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGFjdHVhbGx5ICpibG9ja3MqIHRoZSBzaGVsbCB0b29sXG4gKiBsaXZlIHdhcyBuZXZlciBjb25maXJtZWQgaW4gdGhpcyByZXBvOiB0aGUgUGhhc2UgMCBzcGlrZSBjb3VsZCBub3QgZ2V0IGFcbiAqIGZyb20tc2NyYXRjaCBwbHVnaW4gdG8gbG9hZCwgc28gdGhlIGRlbnkgcGF0aCB3YXMgbmV2ZXIgZXhlcmNpc2VkIGVuZC10by1lbmQuXG4gKiBUaGUgb25seSBwb3NpdGl2ZSBldmlkZW5jZSBpcyBkb2N1bWVudGFyeSBcdTIwMTQgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRVxuICogKHRoZSBleGFjdCB2ZXJzaW9uIHRoaXMgcmVwbyBkZXBlbmRzIG9uKSBzaGlwcyBhIHdvcmtlZCBgcGVybWlzc2lvbkRlY2lzaW9uOlxuICogJ2RlbnknYCBleGFtcGxlIG1hdGNoZWQgb24gYFwiQmFzaFwiYC4gVGhpcyBhZGFwdGVyIHRoZXJlZm9yZSBzaGlwcyB0aGUgaGFyZC1kZW55XG4gKiBwYXRoIHBlciB0aGF0IFJFQURNRSAoe0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSA9IGB0cnVlYCksIGJ1dCBrZWVwcyB0aGVcbiAqIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBcdTIwMTQgYSBsb3VkIGBhZGRpdGlvbmFsQ29udGV4dGAgd2FybmluZyB0aGF0IGFsbG93c1xuICogdGhlIGNvbW1hbmQsIHdpdGggdGhlIENJIHJlY2lwZSBhcyBDb2RleCdzIGVuZm9yY2VtZW50IGJhY2tzdG9wIFx1MjAxNCBhcyBhIGNsZWFybHlcbiAqIHNlcGFyYWJsZSBicmFuY2ggYmVoaW5kIHRoYXQgb25lIGNvbnN0YW50LiBJZiBhIGxpdmUgc2Vzc2lvbiBzaG93cyBkZW55IGRvZXNcbiAqIG5vdCBmaXJlLCBmbGlwIHtAbGluayBDT0RFWF9HQVRFX0hBUkRfREVOWX0gdG8gYGZhbHNlYDsgbm90aGluZyBlbHNlIGNoYW5nZXMuXG4gKlxuICogVGhlIHNoZWxsIHRvb2wncyBleGFjdCBgdG9vbF9uYW1lYCBpcyBsaWtld2lzZSB1bmNvbmZpcm1lZCAodGhlIFJFQURNRSdzXG4gKiBleGFtcGxlIHVzZXMgYFwiQmFzaFwiYDsgQ29kZXggQ0xJIHRyYW5zY3JpcHRzIGluIHRoZSBzcGlrZSBsYWJlbGVkIHRoZSBjYWxsXG4gKiBgZXhlY2ApLiBUaGUgcmVnaXN0cmF0aW9uIG1hdGNoZXIgaXMgYnJvYWRlbmVkIHRvIHRoZSBwbGF1c2libGUgbmFtZXMgc28gdGhlXG4gKiBob29rIGFjdHVhbGx5IGZpcmVzLCBhbmQgZXZlcnkgZmlyZSBsb2dzIHRoZSBvYnNlcnZlZCBgdG9vbF9uYW1lYCBzbyB0aGUgZmlyc3RcbiAqIGxpdmUgcnVuIHJldmVhbHMgdGhlIGxpdGVyYWwgc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0by5cbiAqXG4gKiBGYWlsLW9wZW4gYXQgZXZlcnkgbGF5ZXI6IGdhdGUtY29yZSByZXNvbHZlcyBpbnRlcm5hbCBlcnJvcnMgdG8gYWxsb3csIGFuZCB0aGlzXG4gKiBhZGFwdGVyIHdyYXBzIHRoZSB3aG9sZSBwYXRoIGluIGEgdHJ5L2NhdGNoIHRoYXQgYWxsb3dzLWFuZC1sb2dzIFx1MjAxNCB0aGUgZ2F0ZVxuICogbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDb2RleCBDTElcbiAqIGRpdmlkZXMgdG8gc2Vjb25kcyBhdCBlbWl0KS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFByZVRvb2xVc2VJbnB1dCwgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHtcbiAgY29tbWl0U3RhZ2VzQWxsLFxuICBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyxcbiAgY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yLFxuICBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgZXZhbHVhdGVHYXRlLFxuICB0eXBlIEdhdGVFeGVjdXRvcnMsXG4gIHR5cGUgR2F0ZU1lbW9TdGF0ZSxcbiAgdHlwZSBHaXRFeGVjdXRvcixcbiAgcGFyc2VHaXRDb21tYW5kLFxuICByZXNvbHZlQ2hhbmdlc2V0LFxuICB3cmFwR2l0U3BhbkNvbnRleHRcbn0gZnJvbSAnLi4vY29tbW9uL2dhdGUtY29yZS5qcyc7XG5cbi8qKlxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgaXMgdHJ1c3RlZCB0byBibG9jayB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZS4gU2hpcHMgYHRydWVgIChoYXJkIGRlbnkpIHBlciB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FJ3Mgd29ya2VkXG4gKiBleGFtcGxlLiBGbGlwIHRvIGBmYWxzZWAgdG8gYWN0aXZhdGUgdGhlIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBpZiBhIGxpdmVcbiAqIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzIG5vdCBmaXJlIFx1MjAxNCBzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCBhbmQgdGhpc1xuICogZmlsZSdzIGhlYWRlci4gVGhpcyBpcyB0aGUgc2luZ2xlIHN3aXRjaCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGNvZGUgcGF0aHMuXG4gKi9cbmNvbnN0IENPREVYX0dBVEVfSEFSRF9ERU5ZID0gdHJ1ZTtcblxuLyoqXG4gKiBOYXJyb3cgQ29kZXgncyBgdW5rbm93bmAgc2hlbGwgYHRvb2xfaW5wdXRgIGludG8gdGhlIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlXG4gKiBwYXJzZXMuIEhhbmRsZXMgYSBiYXJlIGBjb21tYW5kYCBzdHJpbmcsIGEgc2hlbGwtd3JhcHBlciBhcmd2XG4gKiAoYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gIFx1MjE5MiB0aGUgc2NyaXB0IGFmdGVyIGAtY2AvYC1sY2ApLCBhbmQgYSBkaXJlY3QgYXJndlxuICogKGBbXCJnaXRcIixcImNvbW1pdFwiLFx1MjAyNl1gIFx1MjE5MiBzcGFjZS1qb2luZWQpLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIGNvbW1hbmQgdGV4dCBpc1xuICogcmVjb3ZlcmFibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U2hlbGxDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ID09PSBudWxsIHx8IHR5cGVvZiB0b29sSW5wdXQgIT09ICdvYmplY3QnIHx8ICEoJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkpIHJldHVybiBudWxsO1xuICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQubGVuZ3RoID4gMCA/IGNvbW1hbmQgOiBudWxsO1xuICBpZiAoQXJyYXkuaXNBcnJheShjb21tYW5kKSkge1xuICAgIGNvbnN0IHBhcnRzID0gY29tbWFuZC5maWx0ZXIoKHApOiBwIGlzIHN0cmluZyA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYWdJZHggPSBwYXJ0cy5maW5kSW5kZXgoKHApID0+IHAgPT09ICctYycgfHwgcCA9PT0gJy1sYycgfHwgcCA9PT0gJy1pYycpO1xuICAgIGlmIChmbGFnSWR4ID49IDAgJiYgcGFydHNbZmxhZ0lkeCArIDFdICE9PSB1bmRlZmluZWQpIHJldHVybiBwYXJ0c1tmbGFnSWR4ICsgMV07XG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oJyAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGdpdDogR2l0RXhlY3V0b3IgPSBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IoKSxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IChjd2Q6IHN0cmluZykgPT4gR2F0ZU1lbW9TdGF0ZSA9IGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICAvLyBUaGUgaGFyZC1kZW55IHN3aXRjaCBpcyBhIHBhcmFtZXRlciAoZGVmYXVsdGluZyB0byB0aGUgc2hpcHBlZCBjb25zdGFudCkgc29cbiAgLy8gdGhlIGRvY3VtZW50ZWQgZmFsbGJhY2sgYnJhbmNoIGlzIGRpcmVjdGx5IGV4ZXJjaXNhYmxlIGluIHRlc3RzIHdpdGhvdXRcbiAgLy8gbXV0YXRpbmcgYSBtb2R1bGUtbGV2ZWwgY29uc3QuIFByb2R1Y3Rpb24gd2lyaW5nIG5ldmVyIHBhc3NlcyB0aGlzIFx1MjAxNCB0aGVcbiAgLy8gZGVmYXVsdCBleHBvcnQgYmVsb3cgY29uc3RydWN0cyB0aGUgaGFuZGxlciB3aXRoIHRoZSBjb25zdGFudCdzIHZhbHVlLlxuICBoYXJkRGVueTogYm9vbGVhbiA9IENPREVYX0dBVEVfSEFSRF9ERU5ZXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIExvZyB0aGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbF9uYW1lIHNvIHRoZSBmaXJzdCBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsXG4gICAgICAvLyBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvICh0aGUgc3Bpa2UgbmV2ZXIgY29uZmlybWVkIGl0IGVtcGlyaWNhbGx5KS5cbiAgICAgIGN0eC5sb2dnZXIuaW5mbygnZ2l0LXNwYW4gZ2F0ZSBvYnNlcnZlZCBzaGVsbCB0b29sJywgeyB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSB9KTtcblxuICAgICAgY29uc3QgY29tbWFuZCA9IGV4dHJhY3RTaGVsbENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSAnbm9uZScpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICAgIGNvbnN0IGFsbCA9IHBhcnNlZC5raW5kID09PSAnY29tbWl0JyA/IGNvbW1pdFN0YWdlc0FsbChjb21tYW5kKSA6IGZhbHNlO1xuICAgICAgY29uc3QgY2hhbmdlc2V0ID0gYXdhaXQgcmVzb2x2ZUNoYW5nZXNldChwYXJzZWQua2luZCwgYWxsLCBjd2QsIGdpdCwgcGFyc2VkLnBhdGhzKTtcblxuICAgICAgY29uc3QgbW9kZSA9IHBhcnNlZC5raW5kID09PSAnc3RhdHVzJyA/ICdpbmZvcm0nIDogJ2VuZm9yY2UnO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZXZhbHVhdGVHYXRlKGNoYW5nZXNldCwgY3dkLCBleGVjdXRvcnMsIG1lbW9GYWN0b3J5KGN3ZCksIG1vZGUpO1xuICAgICAgaWYgKHJlc3VsdC5kZWNpc2lvbiAhPT0gJ2RlbnknKSB7XG4gICAgICAgIC8vIEVudmlyb25tZW50YWwgc3RhbGVuZXNzIGFuZCBhIGZhaWxlZCBzdGFsZW5lc3Mgc2NhbiBib3RoIGFsbG93XG4gICAgICAgIC8vIChmYWlsLW9wZW4pIGJ1dCBtdXN0IG5vdCBiZSBzd2FsbG93ZWQ6IGxvZyBhbmQgc3VyZmFjZSB0aGUgcmVhc29uIGFzXG4gICAgICAgIC8vIGFkZGl0aW9uYWwgY29udGV4dC5cbiAgICAgICAgaWYgKHJlc3VsdC5raW5kID09PSAnZW52aXJvbm1lbnRhbCcgfHwgcmVzdWx0LmtpbmQgPT09ICdzY2FuLWZhaWxlZCcpIHtcbiAgICAgICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgYWxsb3dlZCB3aXRoIGFuIHVucmVzb2x2ZWQgY29uZGl0aW9uJywgeyByZWFzb246IHJlc3VsdC5yZWFzb24gfSk7XG4gICAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe1xuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IHdyYXBHaXRTcGFuQ29udGV4dChyZXN1bHQucmVhc29uKSxcbiAgICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBgc3RhdHVzYC1vbmx5IGFkdmlzb3J5IGtpbmRzOiBzcGFuIGRlYnQgZXhpc3RzLCBidXQgYSBzdGF0dXMgY2hlY2tcbiAgICAgICAgLy8gbmV2ZXIgaG9sZHMgdGhlIGNvbW1hbmQgXHUyMDE0IHN1cmZhY2UgaXQgYXMgaW5mb3JtYXRpb24sIG5vdCBhIHdhcm5pbmcuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJyB8fCByZXN1bHQua2luZCA9PT0gJ3VuY292ZXJlZC13cml0ZXMtaW5mbycpIHtcbiAgICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogd3JhcEdpdFNwYW5Db250ZXh0KHJlc3VsdC5yZWFzb24pLFxuICAgICAgICAgICAgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXJkRGVueSkge1xuICAgICAgICAvLyBQcmltYXJ5IHBhdGggKHBlciB0aGUgUkVBRE1FKTogYWN0dWFsbHkgYmxvY2sgdGhlIGNvbW1hbmQuXG4gICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHtcbiAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55JyxcbiAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IHJlc3VsdC5yZWFzb24sXG4gICAgICAgICAgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvblxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIC8vIEZhbGxiYWNrIHBhdGggKENBUkQubWQgY29udGluZ2VuY3kpOiBjYW5ub3QgYmxvY2ssIHNvIHN1cmZhY2UgdGhlIHNhbWVcbiAgICAgIC8vIGNoZWNrbGlzdCBhcyBhIGxvdWQgd2FybmluZyBhbmQgYWxsb3cgXHUyMDE0IHRoZSBDSSByZWNpcGUgZW5mb3JjZXMgZm9yIENvZGV4LlxuICAgICAgY29uc3Qgd2FybmluZyA9IGBDb3VsZCBub3QgYmxvY2sgdGhpcyBjb21tYW5kIFx1MjAxNCB0aGUgaXNzdWUgYmVsb3cgc3RpbGwgbmVlZHMgcmVzb2x2aW5nOlxcbiR7cmVzdWx0LnJlYXNvbn1gO1xuICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogd3JhcEdpdFNwYW5Db250ZXh0KHdhcm5pbmcpLCBzeXN0ZW1NZXNzYWdlOiB3YXJuaW5nIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGZhaWxlZCBvcGVuIG9uIGFuIHVuY2F1Z2h0IGVycm9yJywgeyBlcnIgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaHxzaGVsbHxleGVjfGxvY2FsX3NoZWxsJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSBcIi4vZ2F0ZS50c1wiO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gXCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qc1wiO1xuZXhlY3V0ZShob29rKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUE0Qk8sSUFBTSwwQkFBMEIsb0JBQUksSUFBSSxDQUFDLGdCQUFnQixvQkFBb0IsZUFBZSxDQUFDOzs7QUM1QnBHLFNBQVMsZUFBZSxlQUFlLFFBQVEsU0FBUztBQUNwRCxRQUFNLE9BQU87QUFDYixPQUFLLGdCQUFnQjtBQUNyQixPQUFLLFVBQVUsT0FBTztBQUN0QixPQUFLLGdCQUFnQixPQUFPO0FBQzVCLE1BQUksYUFBYSxVQUFVLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDM0QsU0FBSyxVQUFVLE9BQU87QUFBQSxFQUMxQjtBQUNBLFNBQU87QUFDWDtBQUNPLFNBQVMsZUFBZSxRQUFRLFNBQVM7QUFDNUMsU0FBTyxlQUFlLGNBQWMsUUFBUSxPQUFPO0FBQ3ZEOzs7QUNaQSxTQUFTLFdBQVcsWUFBWSxXQUFXLFVBQVUsaUJBQWlCO0FBQ3RFLFNBQVMsZUFBZTtBQUN4QixJQUFNLHNCQUFzQjtBQUNyQixJQUFNLFNBQU4sTUFBYTtBQUFBLEVBQ2hCLFdBQVcsb0JBQUksSUFBSTtBQUFBLEVBQ25CLGtCQUFrQjtBQUFBLEVBQ2xCLFlBQVk7QUFBQSxFQUNaLGNBQWM7QUFBQSxFQUNkO0FBQUEsRUFDQTtBQUFBLEVBQ0EsWUFBWSxTQUFTLENBQUMsR0FBRztBQUNyQixTQUFLLGNBQWMsT0FBTyxlQUFlLFFBQVEsSUFBSSxPQUFPLGFBQWEsbUJBQW1CLEtBQUs7QUFBQSxFQUNyRztBQUFBLEVBQ0EsV0FBVyxVQUFVLE9BQU87QUFDeEIsU0FBSyxrQkFBa0I7QUFDdkIsU0FBSyxlQUFlO0FBQUEsRUFDeEI7QUFBQSxFQUNBLGVBQWU7QUFDWCxTQUFLLGtCQUFrQjtBQUN2QixTQUFLLGVBQWU7QUFBQSxFQUN4QjtBQUFBLEVBQ0EsR0FBRyxPQUFPLFNBQVM7QUFDZixVQUFNLFdBQVcsS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLLG9CQUFJLElBQUk7QUFDckQsYUFBUyxJQUFJLE9BQU87QUFDcEIsU0FBSyxTQUFTLElBQUksT0FBTyxRQUFRO0FBQ2pDLFdBQU8sTUFBTTtBQUNULGVBQVMsT0FBTyxPQUFPO0FBQ3ZCLFVBQUksU0FBUyxTQUFTLEdBQUc7QUFDckIsYUFBSyxTQUFTLE9BQU8sS0FBSztBQUFBLE1BQzlCO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFBQSxFQUNBLE1BQU0sU0FBUyxTQUFTO0FBQ3BCLFNBQUssS0FBSyxTQUFTLFNBQVMsT0FBTztBQUFBLEVBQ3ZDO0FBQUEsRUFDQSxLQUFLLFNBQVMsU0FBUztBQUNuQixTQUFLLEtBQUssUUFBUSxTQUFTLE9BQU87QUFBQSxFQUN0QztBQUFBLEVBQ0EsS0FBSyxTQUFTLFNBQVM7QUFDbkIsU0FBSyxLQUFLLFFBQVEsU0FBUyxPQUFPO0FBQUEsRUFDdEM7QUFBQSxFQUNBLE1BQU0sU0FBUyxTQUFTO0FBQ3BCLFNBQUssS0FBSyxTQUFTLFNBQVMsT0FBTztBQUFBLEVBQ3ZDO0FBQUEsRUFDQSxTQUFTLE9BQU8sU0FBUyxTQUFTO0FBQzlCLFNBQUssS0FBSyxTQUFTLEdBQUcsT0FBTyxLQUFLLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUssQ0FBQyxJQUFJLE9BQU87QUFBQSxFQUN2RztBQUFBLEVBQ0EsUUFBUTtBQUNKLFFBQUksS0FBSyxjQUFjLE1BQU07QUFDekIsZ0JBQVUsS0FBSyxTQUFTO0FBQ3hCLFdBQUssWUFBWTtBQUFBLElBQ3JCO0FBQUEsRUFDSjtBQUFBLEVBQ0EsS0FBSyxPQUFPLFNBQVMsU0FBUztBQUMxQixVQUFNLFFBQVE7QUFBQSxNQUNWLFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxNQUNsQztBQUFBLE1BQ0EsVUFBVSxLQUFLO0FBQUEsTUFDZjtBQUFBLE1BQ0EsR0FBSSxLQUFLLGlCQUFpQixTQUFZLEVBQUUsT0FBTyxLQUFLLGFBQWEsSUFBSSxDQUFDO0FBQUEsTUFDdEUsR0FBSSxZQUFZLFNBQVksRUFBRSxRQUFRLElBQUksQ0FBQztBQUFBLElBQy9DO0FBQ0EsU0FBSyxZQUFZLEtBQUs7QUFDdEIsU0FBSyxTQUFTLElBQUksS0FBSyxHQUFHLFFBQVEsQ0FBQyxZQUFZO0FBQzNDLGNBQVEsS0FBSztBQUFBLElBQ2pCLENBQUM7QUFBQSxFQUNMO0FBQUEsRUFDQSxZQUFZLE9BQU87QUFDZixRQUFJLEtBQUssZ0JBQWdCLE1BQU07QUFDM0I7QUFBQSxJQUNKO0FBQ0EsUUFBSSxDQUFDLEtBQUssaUJBQWlCO0FBQ3ZCLFdBQUssa0JBQWtCO0FBQ3ZCLFlBQU0sU0FBUyxRQUFRLEtBQUssV0FBVztBQUN2QyxVQUFJLENBQUMsV0FBVyxNQUFNLEdBQUc7QUFDckIsa0JBQVUsUUFBUSxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQUEsTUFDekM7QUFDQSxXQUFLLFlBQVksU0FBUyxLQUFLLGFBQWEsR0FBRztBQUFBLElBQ25EO0FBQ0EsUUFBSSxLQUFLLGNBQWMsTUFBTTtBQUN6QixnQkFBVSxLQUFLLFdBQVcsR0FBRyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsQ0FBSTtBQUFBLElBQzFEO0FBQUEsRUFDSjtBQUNKO0FBQ08sSUFBTSxTQUFTLElBQUksT0FBTzs7O0FDcEYxQixJQUFNLGFBQWE7QUFBQSxFQUN0QixTQUFTO0FBQUEsRUFDVCxPQUFPO0FBQUEsRUFDUCxPQUFPO0FBQ1g7QUFDTyxJQUFNLGFBQU4sY0FBeUIsTUFBTTtBQUFBLEVBQ2xDO0FBQUEsRUFDQSxZQUFZLFFBQVE7QUFDaEIsVUFBTSxNQUFNO0FBQ1osU0FBSyxPQUFPO0FBQ1osU0FBSyxTQUFTO0FBQUEsRUFDbEI7QUFDSjtBQUNBLFNBQVMsY0FBYyxPQUFPO0FBQzFCLFNBQU8sT0FBTyxZQUFZLE9BQU8sUUFBUSxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUMsRUFBRSxLQUFLLE1BQU0sVUFBVSxNQUFTLENBQUM7QUFDOUY7QUFDQSxTQUFTLFlBQVksTUFBTSxRQUFRLFFBQVE7QUFDdkMsU0FBTztBQUFBLElBQ0gsT0FBTztBQUFBLElBQ1AsUUFBUSxjQUFjLE1BQU07QUFBQSxJQUM1QixHQUFJLFdBQVcsU0FBWSxFQUFFLE9BQU8sSUFBSSxDQUFDO0FBQUEsRUFDN0M7QUFDSjtBQUlPLFNBQVMsaUJBQWlCLFVBQVUsQ0FBQyxHQUFHO0FBQzNDLFFBQU0sY0FBYyxRQUFRLHNCQUFzQixVQUM5QyxRQUFRLHVCQUF1QixVQUMvQixRQUFRLDZCQUE2QixVQUNyQyxRQUFRLGlCQUFpQjtBQUM3QixRQUFNLHFCQUFxQixjQUNyQixjQUFjO0FBQUEsSUFDWixlQUFlO0FBQUEsSUFDZixtQkFBbUIsUUFBUTtBQUFBLElBQzNCLG9CQUFvQixRQUFRO0FBQUEsSUFDNUIsMEJBQTBCLFFBQVE7QUFBQSxJQUNsQyxjQUFjLFFBQVE7QUFBQSxFQUMxQixDQUFDLElBQ0M7QUFDTixTQUFPLFlBQVksY0FBYztBQUFBLElBQzdCLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsZUFBZSxRQUFRO0FBQUEsSUFDdkIsVUFBVSxRQUFRO0FBQUEsSUFDbEIsUUFBUSxRQUFRO0FBQUEsSUFDaEI7QUFBQSxFQUNKLENBQUM7QUFDTDtBQStDTyxTQUFTLHVCQUF1QixVQUFVLENBQUMsR0FBRztBQUNqRCxRQUFNLHFCQUFxQixRQUFRLHNCQUFzQixTQUNuRDtBQUFBLElBQ0UsZUFBZTtBQUFBLElBQ2YsbUJBQW1CLFFBQVE7QUFBQSxFQUMvQixJQUNFO0FBQ04sU0FBTyxZQUFZLG9CQUFvQjtBQUFBLElBQ25DLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsZUFBZSxRQUFRO0FBQUEsSUFDdkIsVUFBVSxRQUFRO0FBQUEsSUFDbEIsUUFBUSxRQUFRO0FBQUEsSUFDaEI7QUFBQSxFQUNKLENBQUM7QUFDTDtBQUNPLFNBQVMsbUJBQW1CLFVBQVUsQ0FBQyxHQUFHO0FBQzdDLFFBQU0scUJBQXFCLFFBQVEsc0JBQXNCLFNBQ25EO0FBQUEsSUFDRSxlQUFlO0FBQUEsSUFDZixtQkFBbUIsUUFBUTtBQUFBLEVBQy9CLElBQ0U7QUFDTixTQUFPLFlBQVksZ0JBQWdCO0FBQUEsSUFDL0IsVUFBVSxRQUFRO0FBQUEsSUFDbEIsWUFBWSxRQUFRO0FBQUEsSUFDcEIsZ0JBQWdCLFFBQVE7QUFBQSxJQUN4QixlQUFlLFFBQVE7QUFBQSxJQUN2QjtBQUFBLEVBQ0osQ0FBQztBQUNMO0FBQ08sU0FBUyxvQkFBb0IsVUFBVSxDQUFDLEdBQUc7QUFDOUMsUUFBTSxxQkFBcUIsUUFBUSxzQkFBc0IsU0FDbkQ7QUFBQSxJQUNFLGVBQWU7QUFBQSxJQUNmLG1CQUFtQixRQUFRO0FBQUEsRUFDL0IsSUFDRTtBQUNOLFNBQU8sWUFBWSxpQkFBaUI7QUFBQSxJQUNoQyxVQUFVLFFBQVE7QUFBQSxJQUNsQixZQUFZLFFBQVE7QUFBQSxJQUNwQixnQkFBZ0IsUUFBUTtBQUFBLElBQ3hCLGVBQWUsUUFBUTtBQUFBLElBQ3ZCO0FBQUEsRUFDSixDQUFDO0FBQ0w7OztBQzNJQSxlQUFlLFlBQVk7QUFDdkIsU0FBTyxJQUFJLFFBQVEsQ0FBQ0EsVUFBUyxXQUFXO0FBQ3BDLFVBQU0sU0FBUyxDQUFDO0FBQ2hCLFlBQVEsTUFBTSxZQUFZLE9BQU87QUFDakMsWUFBUSxNQUFNLEdBQUcsUUFBUSxDQUFDLFVBQVUsT0FBTyxLQUFLLEtBQUssQ0FBQztBQUN0RCxZQUFRLE1BQU0sR0FBRyxPQUFPLE1BQU1BLFNBQVEsT0FBTyxLQUFLLEVBQUUsQ0FBQyxDQUFDO0FBQ3RELFlBQVEsTUFBTSxHQUFHLFNBQVMsTUFBTTtBQUFBLEVBQ3BDLENBQUM7QUFDTDtBQUNBLFNBQVMsZ0JBQWdCLGNBQWM7QUFDbkMsU0FBTyxLQUFLLE1BQU0sWUFBWTtBQUNsQztBQUNBLFNBQVMsWUFBWSxRQUFRO0FBQ3pCLFVBQVEsT0FBTyxNQUFNLEtBQUssVUFBVSxPQUFPLE1BQU0sQ0FBQztBQUN0RDtBQUNBLFNBQVMsc0JBQXNCLGVBQWUsUUFBUTtBQUNsRCxNQUFJLENBQUMsd0JBQXdCLElBQUksYUFBYSxHQUFHO0FBQzdDLFVBQU0sSUFBSSxNQUFNLEdBQUcsYUFBYSxpQ0FBaUM7QUFBQSxFQUNyRTtBQUNBLE1BQUksa0JBQWtCLGdCQUFnQjtBQUNsQyxXQUFPLG1CQUFtQixFQUFFLG1CQUFtQixPQUFPLENBQUM7QUFBQSxFQUMzRDtBQUNBLE1BQUksa0JBQWtCLGlCQUFpQjtBQUNuQyxXQUFPLG9CQUFvQixFQUFFLG1CQUFtQixPQUFPLENBQUM7QUFBQSxFQUM1RDtBQUNBLFNBQU8sdUJBQXVCLEVBQUUsbUJBQW1CLE9BQU8sQ0FBQztBQUMvRDtBQUNPLFNBQVMsb0JBQW9CLFFBQVE7QUFDeEMsU0FBTyxPQUFPLFdBQVcsU0FBWSxFQUFFLFFBQVEsT0FBTyxRQUFRLFFBQVEsT0FBTyxPQUFPLElBQUksRUFBRSxRQUFRLE9BQU8sT0FBTztBQUNwSDtBQUNBLGVBQXNCLFFBQVEsUUFBUTtBQUNsQyxNQUFJO0FBQ0EsVUFBTSxlQUFlLE1BQU0sVUFBVTtBQUNyQyxVQUFNLFFBQVEsZ0JBQWdCLFlBQVk7QUFDMUMsV0FBTyxXQUFXLE9BQU8sZUFBZSxLQUFLO0FBQzdDLFVBQU0sVUFBVSxFQUFFLE9BQU87QUFDekIsVUFBTSxTQUFTLE1BQU0sT0FBTyxPQUFPLE9BQU87QUFDMUMsUUFBSSxTQUFTLEVBQUUsUUFBUSxDQUFDLEVBQUU7QUFDMUIsUUFBSSxPQUFPLFdBQVcsVUFBVTtBQUM1QixlQUFTLG9CQUFvQixzQkFBc0IsT0FBTyxlQUFlLE1BQU0sQ0FBQztBQUFBLElBQ3BGLFdBQ1MsV0FBVyxRQUFXO0FBQzNCLGVBQVMsb0JBQW9CLE1BQU07QUFBQSxJQUN2QztBQUNBLGdCQUFZLE1BQU07QUFDbEIsWUFBUSxLQUFLLFdBQVcsT0FBTztBQUFBLEVBQ25DLFNBQ08sT0FBTztBQUNWLFFBQUksaUJBQWlCLFlBQVk7QUFDN0IsY0FBUSxPQUFPLE1BQU0sR0FBRyxNQUFNLE1BQU07QUFBQSxDQUFJO0FBQ3hDLGNBQVEsS0FBSyxXQUFXLEtBQUs7QUFBQSxJQUNqQztBQUNBLFFBQUksaUJBQWlCLE9BQU87QUFDeEIsY0FBUSxPQUFPLE1BQU0sR0FBRyxNQUFNLFNBQVMsTUFBTSxPQUFPO0FBQUEsQ0FBSTtBQUFBLElBQzVELE9BQ0s7QUFDRCxjQUFRLE9BQU8sTUFBTSxHQUFHLE9BQU8sS0FBSyxDQUFDO0FBQUEsQ0FBSTtBQUFBLElBQzdDO0FBQ0EsWUFBUSxLQUFLLFdBQVcsS0FBSztBQUFBLEVBQ2pDLFVBQ0E7QUFDSSxXQUFPLGFBQWE7QUFDcEIsV0FBTyxNQUFNO0FBQUEsRUFDakI7QUFDSjs7O0FDdkNBLFNBQVMsZ0JBQUFDLHFCQUFvQjtBQUM3QixTQUFTLGtCQUFrQjtBQUMzQixZQUFZQyxTQUFRO0FBQ3BCLFlBQVlDLGVBQWM7OztBQ3RCMUIsU0FBUyxvQkFBb0I7QUFDN0IsWUFBWSxRQUFRO0FBQ3BCLFlBQVksUUFBUTtBQUNwQixZQUFZLGNBQWM7QUFNbkIsU0FBUyxRQUFRLEdBQW1CO0FBQ3pDLFNBQU8sRUFBRSxRQUFRLE9BQU8sR0FBRztBQUM3QjtBQWFPLFNBQVMsZ0JBQWdCLEtBQStDO0FBQzdFLE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsTUFBSTtBQUNGLFVBQU0sTUFBTSxhQUFhLE9BQU8sQ0FBQyxNQUFNLEtBQUssYUFBYSxpQkFBaUIsR0FBRztBQUFBLE1BQzNFLE9BQU8sQ0FBQyxVQUFVLFFBQVEsUUFBUTtBQUFBLE1BQ2xDLFVBQVU7QUFBQSxJQUNaLENBQUM7QUFDRCxVQUFNLFVBQVUsSUFBSSxLQUFLO0FBQ3pCLFdBQU8sUUFBUSxTQUFTLElBQUksUUFBUSxPQUFPLElBQUk7QUFBQSxFQUNqRCxRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQWtCTyxJQUFNLFlBQVk7QUF3Q2xCLFNBQVMsaUJBQWlCLGFBQXFCLFdBQW1CLFdBQW9CO0FBQzNGLFFBQU0sT0FBTyxTQUFTLFFBQVEsUUFBUSxFQUFFO0FBQ3hDLFNBQU8sZ0JBQWdCLFFBQVEsWUFBWSxXQUFXLEdBQUcsSUFBSSxHQUFHO0FBQ2xFO0FBb0VPLFNBQVMsZUFBZSxRQUFnQztBQUM3RCxRQUFNLE9BQXVCLENBQUM7QUFDOUIsYUFBVyxRQUFRLE9BQU8sTUFBTSxJQUFJLEdBQUc7QUFDckMsVUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixRQUFJLENBQUMsUUFBUztBQUNkLFVBQU0sUUFBUSxRQUFRLE1BQU0sR0FBSTtBQUNoQyxRQUFJLE1BQU0sU0FBUyxFQUFHO0FBQ3RCLFVBQU0sQ0FBQyxNQUFNLE1BQU0sS0FBSyxJQUFJO0FBQzVCLFVBQU0sVUFBVSxNQUFNLFFBQVEsR0FBRztBQUNqQyxRQUFJLFlBQVksR0FBSTtBQUNwQixVQUFNLFFBQVEsU0FBUyxNQUFNLE1BQU0sR0FBRyxPQUFPLEdBQUcsRUFBRTtBQUNsRCxVQUFNLE1BQU0sU0FBUyxNQUFNLE1BQU0sVUFBVSxDQUFDLEdBQUcsRUFBRTtBQUNqRCxRQUFJLE9BQU8sTUFBTSxLQUFLLEtBQUssT0FBTyxNQUFNLEdBQUcsRUFBRztBQUM5QyxTQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFBQSxFQUN0QztBQUNBLFNBQU87QUFDVDtBQVNPLElBQU0scUJBQXFCO0FBQUEsRUFDaEM7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFDRjtBQUlBLElBQU0sdUJBQTRDLElBQUksSUFBSSxrQkFBa0I7QUFFNUUsU0FBUyxxQkFBcUIsS0FBcUM7QUFDakUsU0FBTyxxQkFBcUIsSUFBSSxHQUFHLElBQUssTUFBMEI7QUFDcEU7QUF1Qk8sU0FBUyxPQUFPLFFBQWtDO0FBQ3ZELFVBQVEsUUFBUTtBQUFBLElBQ2QsS0FBSztBQUFBLElBQ0wsS0FBSztBQUFBLElBQ0wsS0FBSztBQUNILGFBQU87QUFBQSxJQUNUO0FBQ0UsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQVFPLFNBQVMsaUJBQWlCLFFBQWlDO0FBQ2hFLFNBQU8sT0FBTyxZQUFZLEVBQUUsUUFBUSxNQUFNLEdBQUc7QUFDL0M7QUFxQk8sU0FBUyxzQkFBc0IsUUFBa0M7QUFDdEUsVUFBUSxRQUFRO0FBQUEsSUFDZCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1Q7QUFDRSxhQUFPO0FBQUEsRUFDWDtBQUNGO0FBV08sU0FBUyxvQkFBb0IsUUFBcUM7QUFDdkUsUUFBTSxPQUE0QixDQUFDO0FBQ25DLGFBQVcsUUFBUSxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQ3JDLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxDQUFDLFdBQVcsUUFBUSxXQUFXLEdBQUcsRUFBRztBQUN6QyxVQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUk7QUFDaEMsUUFBSSxNQUFNLFNBQVMsRUFBRztBQUN0QixVQUFNLENBQUMsV0FBVyxFQUFFLE1BQU0sTUFBTSxVQUFVLE1BQU0sSUFBSTtBQUNwRCxVQUFNLFNBQVMscUJBQXFCLFNBQVM7QUFDN0MsUUFBSSxDQUFDLE9BQVE7QUFDYixVQUFNLFFBQVEsYUFBYSxZQUFZLElBQUksU0FBUyxVQUFVLEVBQUU7QUFDaEUsVUFBTSxNQUFNLFdBQVcsTUFBTSxJQUFJLFNBQVMsUUFBUSxFQUFFO0FBQ3BELFFBQUksT0FBTyxNQUFNLEtBQUssS0FBSyxPQUFPLE1BQU0sR0FBRyxFQUFHO0FBQzlDLFNBQUssS0FBSyxFQUFFLE1BQU0sTUFBTSxPQUFPLEtBQUssT0FBTyxDQUFDO0FBQUEsRUFDOUM7QUFDQSxTQUFPO0FBQ1Q7QUF3Qk8sSUFBTSxtQkFBNEIsY0FBUSxXQUFRLEdBQUcsVUFBVSxZQUFZLFNBQVM7QUFPM0YsSUFBTSxpQkFBaUIsS0FBSyxLQUFLLEtBQUssS0FBSztBQXlFcEMsU0FBUyxvQkFBb0IsVUFBMEI7QUFDNUQsUUFBTSxNQUFNLGFBQWEsT0FBTyxDQUFDLE1BQU0sVUFBVSxhQUFhLGtCQUFrQixHQUFHO0FBQUEsSUFDakYsT0FBTyxDQUFDLFVBQVUsUUFBUSxRQUFRO0FBQUEsSUFDbEMsVUFBVTtBQUFBLEVBQ1osQ0FBQztBQUNELFFBQU0sVUFBVSxRQUFRLElBQUksS0FBSyxDQUFDO0FBR2xDLE1BQUksQ0FBVSxvQkFBVyxPQUFPLEdBQUc7QUFDakMsV0FBTyxRQUFpQixpQkFBUSxVQUFVLE9BQU8sQ0FBQztBQUFBLEVBQ3BEO0FBQ0EsU0FBTztBQUNUO0FBS08sU0FBUyxVQUFVLFVBQTBCO0FBQ2xELFNBQWdCLGNBQUssb0JBQW9CLFFBQVEsR0FBRyxVQUFVO0FBQ2hFO0FBT08sU0FBUyxZQUFZLFVBQTBCO0FBQ3BELFNBQWdCLGNBQUssVUFBVSxRQUFRLEdBQUcsTUFBTTtBQUNsRDs7O0FDbGFBLFlBQVlDLFNBQVE7QUFDcEIsWUFBWUMsZUFBYzs7O0FDTDFCLFlBQVlDLFNBQVE7QUFDcEIsWUFBWUMsZUFBYztBQVcxQixJQUFNLGtCQUEyQixlQUFLLFNBQVMsYUFBYTtBQU01RCxTQUFTLGFBQWEsTUFBc0I7QUFDMUMsTUFBSSxLQUFLO0FBQ1QsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsS0FBSztBQUNwQyxVQUFNLElBQUksS0FBSyxDQUFDO0FBQ2hCLFFBQUksTUFBTSxLQUFLO0FBQ2IsVUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLEtBQUs7QUFDdkIsY0FBTTtBQUNOO0FBRUEsWUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLElBQUs7QUFBQSxNQUMzQixPQUFPO0FBQ0wsY0FBTTtBQUFBLE1BQ1I7QUFBQSxJQUNGLFdBQVcsTUFBTSxLQUFLO0FBQ3BCLFlBQU07QUFBQSxJQUNSLE9BQU87QUFDTCxZQUFNLEVBQUUsUUFBUSxxQkFBcUIsTUFBTTtBQUFBLElBQzdDO0FBQUEsRUFDRjtBQUNBLFNBQU8sSUFBSSxPQUFPLElBQUksRUFBRSxHQUFHO0FBQzdCO0FBR0EsU0FBUyxjQUFjLE1BQXdCO0FBQzdDLFFBQU0sUUFBUSxLQUFLLE1BQU0sR0FBRztBQUM1QixRQUFNLE1BQWdCLENBQUM7QUFDdkIsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUNyQyxRQUFJLEtBQUssTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFBQSxFQUMxQztBQUNBLFNBQU87QUFDVDtBQVlPLFNBQVMsZUFBZSxTQUFtRDtBQUNoRixNQUFJLE1BQU07QUFDVixNQUFJLFVBQVU7QUFDZCxNQUFJLElBQUksU0FBUyxHQUFHLEdBQUc7QUFDckIsY0FBVTtBQUNWLFVBQU0sSUFBSSxNQUFNLEdBQUcsRUFBRTtBQUFBLEVBQ3ZCO0FBQ0EsTUFBSSxXQUFXLElBQUksU0FBUyxHQUFHO0FBQy9CLE1BQUksSUFBSSxXQUFXLEdBQUcsR0FBRztBQUN2QixlQUFXO0FBQ1gsVUFBTSxJQUFJLE1BQU0sQ0FBQztBQUFBLEVBQ25CO0FBQ0EsUUFBTSxLQUFLLGFBQWEsR0FBRztBQUUzQixTQUFPLENBQUMsZ0JBQXdCO0FBQzlCLFFBQUksVUFBVTtBQUNaLFlBQU0sT0FBTyxjQUFjLFdBQVc7QUFFdEMsWUFBTUMsY0FBYSxVQUFVLEtBQUssTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUNqRCxhQUFPQSxZQUFXLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFBQSxJQUMxQztBQUVBLFVBQU0sYUFBYSxZQUFZLE1BQU0sR0FBRztBQUN4QyxVQUFNLGFBQWEsVUFBVSxXQUFXLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFDdkQsV0FBTyxXQUFXLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFBQSxFQUMxQztBQUNGOzs7QUR2RUEsSUFBTSxrQkFBMkIsZUFBSyxTQUFTLGFBQWE7QUFHckQsU0FBUyxnQkFBZ0IsU0FBbUM7QUFDakUsUUFBTSxRQUEwQixDQUFDO0FBQ2pDLGFBQVcsV0FBVyxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBQ3pDLFVBQU0sVUFBVSxRQUFRLEtBQUs7QUFDN0IsUUFBSSxDQUFDLFdBQVcsUUFBUSxXQUFXLEdBQUcsRUFBRztBQUN6QyxVQUFNLEtBQUssRUFBRSxTQUFTLFNBQVMsZUFBZSxPQUFPLEVBQUUsQ0FBQztBQUFBLEVBQzFEO0FBQ0EsU0FBTztBQUNUO0FBT08sU0FBUyxlQUFlLFVBQW9DO0FBQ2pFLE1BQUk7QUFDRixVQUFNLFVBQWEsaUJBQXNCLGVBQUssVUFBVSxlQUFlLEdBQUcsTUFBTTtBQUNoRixXQUFPLGdCQUFnQixPQUFPO0FBQUEsRUFDaEMsUUFBUTtBQUNOLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDRjtBQUdPLFNBQVMsY0FBYyxPQUF5QixhQUE4QjtBQUNuRixTQUFPLE1BQU0sS0FBSyxDQUFDLFNBQVMsS0FBSyxRQUFRLFdBQVcsQ0FBQztBQUN2RDs7O0FGakJPLElBQU0sZ0JBQU4sY0FBNEIsTUFBTTtBQUFBLEVBQzlCO0FBQUEsRUFDVCxZQUFZLFFBQWdCO0FBQzFCLFVBQU0sK0NBQStDLE1BQU0sRUFBRTtBQUM3RCxTQUFLLE9BQU87QUFDWixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUNGO0FBcURPLFNBQVMsZ0JBQWdCLFNBQW1DO0FBQ2pFLGFBQVcsV0FBVyxjQUFjLE9BQU8sR0FBRztBQUM1QyxVQUFNLE1BQU0sbUJBQW1CLFNBQVMsT0FBTyxDQUFDO0FBQ2hELFFBQUksQ0FBQyxJQUFLO0FBQ1YsUUFBSSxJQUFJLGVBQWUsVUFBVTtBQUMvQixZQUFNLFdBQVcsSUFBSSxLQUFLLFFBQVEsSUFBSTtBQUN0QyxZQUFNLFFBQVEsWUFBWSxJQUFJLElBQUksS0FBSyxNQUFNLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLElBQUksQ0FBQztBQUMxRixhQUFPLE1BQU0sU0FBUyxJQUFJLEVBQUUsTUFBTSxVQUFVLE1BQU0sSUFBSSxFQUFFLE1BQU0sU0FBUztBQUFBLElBQ3pFO0FBQ0EsUUFBSSxJQUFJLGVBQWUsUUFBUTtBQUM3QixhQUFPLEVBQUUsTUFBTSxPQUFPO0FBQUEsSUFDeEI7QUFDQSxRQUFJLElBQUksZUFBZSxVQUFVO0FBQy9CLGFBQU8sRUFBRSxNQUFNLFNBQVM7QUFBQSxJQUMxQjtBQUFBLEVBR0Y7QUFDQSxTQUFPLEVBQUUsTUFBTSxPQUFPO0FBQ3hCO0FBa0JBLElBQU0sdUJBQXVCLG9CQUFJLElBQUk7QUFBQSxFQUNuQztBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFDRixDQUFDO0FBRU0sU0FBUyxnQkFBZ0IsU0FBMEI7QUFDeEQsYUFBVyxXQUFXLGNBQWMsT0FBTyxHQUFHO0FBQzVDLFVBQU0sTUFBTSxtQkFBbUIsU0FBUyxPQUFPLENBQUM7QUFDaEQsUUFBSSxDQUFDLE9BQU8sSUFBSSxlQUFlLFNBQVU7QUFDekMsVUFBTSxXQUFXLElBQUksS0FBSyxRQUFRLElBQUk7QUFDdEMsVUFBTSxXQUFXLFlBQVksSUFBSSxJQUFJLEtBQUssTUFBTSxHQUFHLFFBQVEsSUFBSSxJQUFJO0FBQ25FLGFBQVMsSUFBSSxHQUFHLElBQUksU0FBUyxRQUFRLEtBQUs7QUFDeEMsWUFBTSxNQUFNLFNBQVMsQ0FBQztBQUN0QixVQUFJLFFBQVEsUUFBUyxRQUFPO0FBRzVCLFVBQUkscUJBQXFCLElBQUksR0FBRyxHQUFHO0FBQ2pDO0FBQ0E7QUFBQSxNQUNGO0FBQ0EsVUFBSSxDQUFDLElBQUksV0FBVyxJQUFJLEtBQUsseUJBQXlCLEtBQUssR0FBRyxFQUFHLFFBQU87QUFBQSxJQUMxRTtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUO0FBTUEsSUFBTSxxQkFBcUIsb0JBQUksSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDO0FBQy9DLElBQU0sc0JBQXNCLG9CQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssR0FBRyxDQUFDO0FBR25FLFNBQVMsY0FBYyxTQUEyQjtBQUNoRCxRQUFNLFdBQXFCLENBQUM7QUFDNUIsTUFBSSxVQUFVO0FBQ2QsTUFBSSxRQUEwQjtBQUM5QixXQUFTLElBQUksR0FBRyxJQUFJLFFBQVEsUUFBUSxLQUFLO0FBQ3ZDLFVBQU0sS0FBSyxRQUFRLENBQUM7QUFDcEIsUUFBSSxPQUFPO0FBQ1QsaUJBQVc7QUFDWCxVQUFJLE9BQU8sTUFBTyxTQUFRO0FBQzFCO0FBQUEsSUFDRjtBQUNBLFFBQUksT0FBTyxPQUFPLE9BQU8sS0FBSztBQUM1QixjQUFRO0FBQ1IsaUJBQVc7QUFDWDtBQUFBLElBQ0Y7QUFDQSxRQUFJLG1CQUFtQixJQUFJLFFBQVEsTUFBTSxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUc7QUFDbkQsZUFBUyxLQUFLLE9BQU87QUFDckIsZ0JBQVU7QUFDVjtBQUNBO0FBQUEsSUFDRjtBQUNBLFFBQUksb0JBQW9CLElBQUksRUFBRSxHQUFHO0FBQy9CLGVBQVMsS0FBSyxPQUFPO0FBQ3JCLGdCQUFVO0FBQ1Y7QUFBQSxJQUNGO0FBQ0EsZUFBVztBQUFBLEVBQ2I7QUFDQSxXQUFTLEtBQUssT0FBTztBQUNyQixTQUFPO0FBQ1Q7QUFRQSxTQUFTLFNBQVMsU0FBMkI7QUFDM0MsUUFBTSxTQUFtQixDQUFDO0FBQzFCLE1BQUksVUFBVTtBQUNkLE1BQUksTUFBTTtBQUNWLE1BQUksUUFBMEI7QUFDOUIsV0FBUyxJQUFJLEdBQUcsSUFBSSxRQUFRLFFBQVEsS0FBSztBQUN2QyxVQUFNLEtBQUssUUFBUSxDQUFDO0FBQ3BCLFFBQUksT0FBTztBQUNULFVBQUksT0FBTyxNQUFPLFNBQVE7QUFBQSxVQUNyQixZQUFXO0FBQ2hCLFlBQU07QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sT0FBTyxPQUFPLEtBQUs7QUFDNUIsY0FBUTtBQUNSLFlBQU07QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sT0FBTyxPQUFPLEtBQU07QUFDN0IsVUFBSSxLQUFLO0FBQ1AsZUFBTyxLQUFLLE9BQU87QUFDbkIsa0JBQVU7QUFDVixjQUFNO0FBQUEsTUFDUjtBQUNBO0FBQUEsSUFDRjtBQUNBLGVBQVc7QUFDWCxVQUFNO0FBQUEsRUFDUjtBQUNBLE1BQUksSUFBSyxRQUFPLEtBQUssT0FBTztBQUM1QixTQUFPO0FBQ1Q7QUFHQSxJQUFNLG9CQUFvQixvQkFBSSxJQUFJO0FBQUEsRUFDaEM7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFhRCxTQUFTLG1CQUFtQixRQUF3QztBQUNsRSxNQUFJLElBQUk7QUFDUixTQUFPLElBQUksT0FBTyxVQUFVLDJCQUEyQixLQUFLLE9BQU8sQ0FBQyxDQUFDLEVBQUc7QUFDeEUsTUFBSSxLQUFLLE9BQU8sVUFBVSxPQUFPLENBQUMsTUFBTSxNQUFPLFFBQU87QUFDdEQ7QUFDQSxTQUFPLElBQUksT0FBTyxRQUFRO0FBQ3hCLFVBQU0sSUFBSSxPQUFPLENBQUM7QUFDbEIsUUFBSSxNQUFNLEtBQU0sUUFBTztBQUN2QixRQUFJLENBQUMsRUFBRSxXQUFXLEdBQUcsRUFBRztBQUN4QixTQUFLLGtCQUFrQixJQUFJLENBQUMsSUFBSSxJQUFJO0FBQUEsRUFDdEM7QUFDQSxNQUFJLEtBQUssT0FBTyxPQUFRLFFBQU87QUFDL0IsU0FBTyxFQUFFLFlBQVksT0FBTyxDQUFDLEdBQUcsTUFBTSxPQUFPLE1BQU0sSUFBSSxDQUFDLEVBQUU7QUFDNUQ7QUE0RUEsZUFBc0IsaUJBQ3BCLE1BQ0EsS0FDQSxLQUNBLEtBQ0EsT0FDbUI7QUFDbkIsTUFBSSxTQUFTLFFBQVE7QUFDbkIsV0FBTyxJQUFJLGNBQWMsR0FBRztBQUFBLEVBQzlCO0FBQ0EsTUFBSSxTQUFTLFVBQVU7QUFDckIsVUFBTSxDQUFDQyxTQUFRQyxRQUFPLElBQUksTUFBTSxRQUFRLElBQUksQ0FBQyxJQUFJLFlBQVksR0FBRyxHQUFHLElBQUkscUJBQXFCLEdBQUcsQ0FBQyxDQUFDO0FBQ2pHLFdBQU8saUJBQWlCRCxTQUFRQyxRQUFPO0FBQUEsRUFDekM7QUFHQSxNQUFJLFNBQVMsTUFBTSxTQUFTLEdBQUc7QUFDN0IsV0FBTyxJQUFJLGNBQWMsT0FBTyxHQUFHO0FBQUEsRUFDckM7QUFDQSxRQUFNLFNBQVMsTUFBTSxJQUFJLFlBQVksR0FBRztBQUN4QyxNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pCLFFBQU0sVUFBVSxNQUFNLElBQUkscUJBQXFCLEdBQUc7QUFDbEQsU0FBTyxpQkFBaUIsUUFBUSxPQUFPO0FBQ3pDO0FBR0EsU0FBUyxvQkFBb0IsUUFBOEI7QUFDekQsUUFBTSxPQUFPLG9CQUFJLElBQVk7QUFDN0IsUUFBTSxTQUFtQixDQUFDO0FBQzFCLGFBQVcsU0FBUyxRQUFRO0FBQzFCLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFVBQUksS0FBSyxJQUFJLElBQUksRUFBRztBQUNwQixXQUFLLElBQUksSUFBSTtBQUNiLGFBQU8sS0FBSyxJQUFJO0FBQUEsSUFDbEI7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBbU5BLGVBQXNCLGFBQ3BCLE9BQ0EsS0FDQSxXQUNBLFdBQ0EsT0FBaUIsV0FDSTtBQUNyQixNQUFJLE1BQU0sV0FBVyxFQUFHLFFBQU8sRUFBRSxVQUFVLFNBQVMsTUFBTSxTQUFTO0FBQ25FLE1BQUk7QUFFRixVQUFNLFVBQVUsSUFBSSxPQUFPLEdBQUc7QUFDOUIsVUFBTSxZQUFZLE1BQU0sVUFBVSxNQUFNLE9BQU8sR0FBRztBQVFsRCxVQUFNLFdBQVcsVUFBVSxPQUFPLENBQUMsUUFBUSxPQUFPLElBQUksTUFBTSxDQUFDO0FBQzdELFVBQU0sV0FBVyxTQUFTLE9BQU8sQ0FBQyxRQUFRLENBQUMsc0JBQXNCLElBQUksTUFBTSxDQUFDO0FBQzVFLFVBQU0sZ0JBQWdCLFNBQVMsT0FBTyxDQUFDLFFBQVEsc0JBQXNCLElBQUksTUFBTSxDQUFDO0FBRWhGLFFBQUksU0FBUyxVQUFVO0FBUXJCLFVBQUksU0FBUyxTQUFTLEdBQUc7QUFDdkIsY0FBTUMsUUFBTyxlQUFlLFdBQVcsZ0JBQWdCLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDcEUsZUFBTztBQUFBLFVBQ0wsVUFBVTtBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ04sVUFBVTtBQUFBLFVBQ1YsUUFBUSxzQkFBc0IsVUFBVSxNQUFNLGdCQUFnQixXQUFXLFVBQVUsR0FBRyxHQUFHLFVBQVVBLEtBQUk7QUFBQSxRQUN6RztBQUFBLE1BQ0Y7QUFDQSxVQUFJLGNBQWMsU0FBUyxHQUFHO0FBQzVCLGVBQU87QUFBQSxVQUNMLFVBQVU7QUFBQSxVQUNWLE1BQU07QUFBQSxVQUNOLFlBQVk7QUFBQSxVQUNaLFFBQVEsMEJBQTBCLGVBQWUsTUFBTSxnQkFBZ0IsV0FBVyxlQUFlLEdBQUcsQ0FBQztBQUFBLFFBQ3ZHO0FBQUEsTUFDRjtBQUNBLFlBQU1DLGFBQVksTUFBTSxzQkFBc0IsT0FBTyxLQUFLLFNBQVM7QUFDbkUsVUFBSUEsV0FBVSxXQUFXLEVBQUcsUUFBTyxFQUFFLFVBQVUsU0FBUyxNQUFNLFNBQVM7QUFDdkUsWUFBTUQsUUFBTyxlQUFlLFdBQVcsZ0JBQWdCLENBQUMsR0FBR0MsVUFBUyxDQUFDO0FBQ3JFLGFBQU87QUFBQSxRQUNMLFVBQVU7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLFdBQUFBO0FBQUEsUUFDQSxRQUFRLHNCQUFzQkEsWUFBVyxVQUFVRCxLQUFJO0FBQUEsTUFDekQ7QUFBQSxJQUNGO0FBS0EsUUFBSSwyQkFBMkI7QUFDL0IsUUFBSSxTQUFTLFNBQVMsR0FBRztBQUN2QixZQUFNLGlCQUFpQixnQkFBZ0IsVUFBVSxDQUFDLENBQUM7QUFDbkQsVUFBSSxDQUFDLFVBQVUsSUFBSSxjQUFjLEdBQUc7QUFHbEMsWUFBSSxDQUFDLFVBQVUsT0FBTyxjQUFjLEVBQUcsUUFBTyxFQUFFLFVBQVUsU0FBUyxNQUFNLFNBQVM7QUFDbEYsY0FBTUEsUUFBTyxlQUFlLFdBQVcsY0FBYztBQUNyRCxlQUFPO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTixVQUFVO0FBQUEsVUFDVixRQUFRLHNCQUFzQixVQUFVLE1BQU0sZ0JBQWdCLFdBQVcsVUFBVSxHQUFHLEdBQUcsV0FBV0EsS0FBSTtBQUFBLFFBQzFHO0FBQUEsTUFDRjtBQUNBLGlDQUEyQjtBQUFBLElBQzdCO0FBT0EsUUFBSSxjQUFjLFNBQVMsR0FBRztBQUM1QixhQUFPO0FBQUEsUUFDTCxVQUFVO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixZQUFZO0FBQUEsUUFDWixRQUFRLDBCQUEwQixlQUFlLE1BQU0sZ0JBQWdCLFdBQVcsZUFBZSxHQUFHLENBQUM7QUFBQSxNQUN2RztBQUFBLElBQ0Y7QUFNQSxVQUFNLFlBQVksTUFBTSxzQkFBc0IsT0FBTyxLQUFLLFNBQVM7QUFDbkUsUUFBSSxVQUFVLFdBQVcsR0FBRztBQUkxQixhQUFPLDJCQUNILEVBQUUsVUFBVSxTQUFTLE1BQU0sb0JBQW9CLElBQy9DLEVBQUUsVUFBVSxTQUFTLE1BQU0sU0FBUztBQUFBLElBQzFDO0FBT0EsVUFBTSxTQUFTLGdCQUFnQixDQUFDLEdBQUcsU0FBUztBQUM1QyxRQUFJLFVBQVUsSUFBSSxNQUFNLEVBQUcsUUFBTyxFQUFFLFVBQVUsU0FBUyxNQUFNLG9CQUFvQjtBQUdqRixRQUFJLENBQUMsVUFBVSxPQUFPLE1BQU0sRUFBRyxRQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sU0FBUztBQUMxRSxVQUFNLE9BQU8sZUFBZSxXQUFXLE1BQU07QUFDN0MsV0FBTztBQUFBLE1BQ0wsVUFBVTtBQUFBLE1BQ1YsTUFBTTtBQUFBLE1BQ047QUFBQSxNQUNBLFFBQVEsc0JBQXNCLFdBQVcsV0FBVyxJQUFJO0FBQUEsSUFDMUQ7QUFBQSxFQUNGLFNBQVMsS0FBSztBQUtaLFFBQUksZUFBZSxlQUFlO0FBQ2hDLGFBQU8sRUFBRSxVQUFVLFNBQVMsTUFBTSxlQUFlLFFBQVEsdUJBQXVCLElBQUksTUFBTSxFQUFFO0FBQUEsSUFDOUY7QUFHQSxXQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sU0FBUztBQUFBLEVBQzdDO0FBQ0Y7QUFlQSxlQUFlLHNCQUFzQixPQUFpQixLQUFhLFdBQTZDO0FBQzlHLE1BQUksTUFBTSxTQUFTLEVBQUcsUUFBTyxDQUFDO0FBQzlCLFFBQU0sV0FBVyxNQUFNLFVBQVUsS0FBSyxPQUFPLEdBQUc7QUFDaEQsUUFBTSxVQUFVLElBQUksSUFBSSxTQUFTLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDO0FBQ3ZELFFBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxRQUFNLGtCQUFrQixXQUFXLGVBQWUsUUFBUSxJQUFJLENBQUM7QUFDL0QsU0FBTyxNQUFNLE9BQU8sQ0FBQyxTQUFTLENBQUMsUUFBUSxJQUFJLElBQUksS0FBSyxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxjQUFjLGlCQUFpQixJQUFJLENBQUM7QUFDdEg7QUFPQSxTQUFTLFdBQVcsS0FBZ0M7QUFDbEQsTUFBSSxJQUFJLFVBQVUsS0FBSyxJQUFJLFFBQVEsRUFBRyxRQUFPLElBQUk7QUFDakQsU0FBTyxHQUFHLElBQUksSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLElBQUksR0FBRztBQUM5QztBQU9BLFNBQVMsZ0JBQWdCLFVBQStCLFdBQTZCO0FBQ25GLFFBQU0sY0FBYyxTQUFTLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxNQUFNLElBQUssSUFBSSxJQUFJLElBQUssSUFBSSxJQUFJLElBQUssSUFBSSxLQUFLLElBQUssSUFBSSxHQUFHLEVBQUUsRUFBRSxLQUFLO0FBQ3BILFFBQU0sVUFBVSxLQUFLLFVBQVUsRUFBRSxVQUFVLGFBQWEsV0FBVyxDQUFDLEdBQUcsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQzFGLFNBQU8sV0FBVyxRQUFRLEVBQUUsT0FBTyxPQUFPLEVBQUUsT0FBTyxLQUFLO0FBQzFEO0FBa0JBLFNBQVMsZUFBZSxXQUEwQixRQUF5QjtBQUN6RSxRQUFNLFVBQVUsUUFBUSxNQUFNO0FBQzlCLFFBQU0sVUFBVSxVQUFVLElBQUksT0FBTztBQUNyQyxZQUFVLE9BQU8sT0FBTztBQUN4QixTQUFPO0FBQ1Q7QUFRQSxlQUFlLGdCQUFnQixXQUEwQixNQUEyQixLQUE4QjtBQUNoSCxRQUFNLFFBQVEsQ0FBQyxHQUFHLElBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLENBQUMsRUFBRSxLQUFLO0FBQzdELE1BQUk7QUFDRixXQUFPLE1BQU0sVUFBVSxXQUFXLE9BQU8sR0FBRztBQUFBLEVBQzlDLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBV0EsU0FBUyxlQUFlLE1BQTRFO0FBQ2xHLFFBQU0sUUFBa0IsQ0FBQztBQUN6QixRQUFNLFNBQVMsb0JBQUksSUFBa0M7QUFDckQsYUFBVyxPQUFPLE1BQU07QUFDdEIsVUFBTSxPQUFPLFdBQVcsR0FBRztBQUMzQixRQUFJLFdBQVcsT0FBTyxJQUFJLElBQUk7QUFDOUIsUUFBSSxDQUFDLFVBQVU7QUFDYixpQkFBVyxvQkFBSSxJQUFJO0FBQ25CLGFBQU8sSUFBSSxNQUFNLFFBQVE7QUFDekIsWUFBTSxLQUFLLElBQUk7QUFBQSxJQUNqQjtBQUNBLGFBQVMsSUFBSSxJQUFJLE1BQU07QUFBQSxFQUN6QjtBQUNBLFNBQU8sTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLE1BQU0sVUFBVSxDQUFDLEdBQUksT0FBTyxJQUFJLElBQUksS0FBSyxDQUFDLENBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRTtBQUN2RjtBQWVBLFNBQVMsZUFBZSxZQUFvQixNQUFtQztBQUM3RSxRQUFNLFlBQVksb0JBQUksSUFBaUM7QUFDdkQsYUFBVyxPQUFPLE1BQU07QUFDdEIsVUFBTSxRQUFRLFVBQVUsSUFBSSxJQUFJLElBQUk7QUFDcEMsUUFBSSxNQUFPLE9BQU0sS0FBSyxHQUFHO0FBQUEsUUFDcEIsV0FBVSxJQUFJLElBQUksTUFBTSxDQUFDLEdBQUcsQ0FBQztBQUFBLEVBQ3BDO0FBRUEsUUFBTSxNQUFnQixDQUFDO0FBQ3ZCLE1BQUksVUFBK0IsQ0FBQztBQUNwQyxNQUFJLFlBQVk7QUFDaEIsUUFBTSxlQUFlLE1BQVk7QUFDL0IsZUFBVyxFQUFFLE1BQU0sU0FBUyxLQUFLLGVBQWUsT0FBTyxHQUFHO0FBQ3hELFVBQUksS0FBSyxLQUFLLElBQUksV0FBTSxTQUFTLElBQUksZ0JBQWdCLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRTtBQUFBLElBQ3JFO0FBQ0EsY0FBVSxDQUFDO0FBQ1gsZ0JBQVk7QUFBQSxFQUNkO0FBRUEsUUFBTSxVQUFVLFdBQVcsS0FBSztBQUNoQyxNQUFJLFFBQVEsU0FBUyxHQUFHO0FBQ3RCLGVBQVcsUUFBUSxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBQ3RDLFlBQU0sU0FBUyxZQUFZLEtBQUssSUFBSTtBQUNwQyxVQUFJLFFBQVE7QUFDVixxQkFBYTtBQUNiLFlBQUksS0FBSyxJQUFJO0FBQ2Isa0JBQVUsVUFBVSxJQUFJLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQztBQUN2QyxrQkFBVSxPQUFPLE9BQU8sQ0FBQyxDQUFDO0FBQzFCLG9CQUFZO0FBQ1o7QUFBQSxNQUNGO0FBQ0EsVUFBSSxhQUFhLEtBQUssV0FBVyxJQUFJLEdBQUc7QUFDdEMsY0FBTSxPQUFPLEtBQUssTUFBTSxDQUFDO0FBQ3pCLGNBQU0sUUFBUSxRQUFRLE9BQU8sQ0FBQyxRQUFRLFdBQVcsR0FBRyxNQUFNLElBQUk7QUFDOUQsY0FBTSxVQUNKLE1BQU0sU0FBUyxJQUFJLFFBQVEsUUFBUSxPQUFPLENBQUMsUUFBUSxTQUFTLElBQUksUUFBUSxLQUFLLFdBQVcsR0FBRyxJQUFJLElBQUksR0FBRyxDQUFDO0FBQ3pHLFlBQUksUUFBUSxTQUFTLEdBQUc7QUFDdEIsZ0JBQU0sYUFBYSxJQUFJLElBQUksT0FBTztBQUNsQyxvQkFBVSxRQUFRLE9BQU8sQ0FBQyxRQUFRLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQztBQUN0RCxnQkFBTSxXQUFXLENBQUMsR0FBRyxJQUFJLElBQUksUUFBUSxJQUFJLENBQUMsUUFBUSxJQUFJLE1BQU0sQ0FBQyxDQUFDLEVBQUUsS0FBSztBQUNyRSxjQUFJLEtBQUssR0FBRyxJQUFJLFdBQU0sU0FBUyxJQUFJLGdCQUFnQixFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUU7QUFBQSxRQUNuRSxPQUFPO0FBQ0wsY0FBSSxLQUFLLElBQUk7QUFBQSxRQUNmO0FBQ0E7QUFBQSxNQUNGO0FBQ0EsVUFBSSxVQUFXLGNBQWE7QUFDNUIsVUFBSSxLQUFLLElBQUk7QUFBQSxJQUNmO0FBQ0EsaUJBQWE7QUFBQSxFQUNmO0FBRUEsYUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLFdBQVc7QUFDckMsUUFBSSxJQUFJLFNBQVMsRUFBRyxLQUFJLEtBQUssSUFBSSxPQUFPLEVBQUU7QUFDMUMsUUFBSSxLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQ3JCLGVBQVcsRUFBRSxNQUFNLFNBQVMsS0FBSyxlQUFlLEtBQUssR0FBRztBQUN0RCxVQUFJLEtBQUssS0FBSyxJQUFJLFdBQU0sU0FBUyxJQUFJLGdCQUFnQixFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUU7QUFBQSxJQUNyRTtBQUFBLEVBQ0Y7QUFFQSxTQUFPLElBQUksS0FBSyxJQUFJO0FBQ3RCO0FBUUEsU0FBUyxzQkFDUCxVQUNBLFlBQ0EsT0FBaUIsV0FDakIsY0FBYyxPQUNOO0FBQ1IsUUFBTSxRQUFRLENBQUMsR0FBRyxJQUFJLElBQUksU0FBUyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQyxDQUFDO0FBQzFELFFBQU0sVUFBVSxNQUFNLFdBQVcsSUFBSSwyQkFBMkI7QUFDaEUsUUFBTSxPQUFPLE1BQU0sV0FBVyxJQUFJLE1BQU0sQ0FBQyxJQUFJO0FBQzdDLFFBQU0sU0FBUyxrQkFBa0IsSUFBSSwwQ0FBMEMsSUFBSTtBQUNuRixNQUFJLGFBQWE7QUFDZixVQUFNLFFBQVEsQ0FBQyxHQUFHLElBQUksSUFBSSxTQUFTLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLENBQUM7QUFDMUQsVUFBTUUsV0FDSixTQUFTLFlBQ0wsOEZBQ0E7QUFDTixXQUFPLENBQUMsNEJBQTRCLE9BQU8saUJBQWlCLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxLQUFLLElBQUksRUFBRSxHQUFHLElBQUlBLFFBQU8sRUFBRTtBQUFBLE1BQzVHO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxRQUFNLFVBQ0osU0FBUyxZQUNMLDBEQUFxRCxNQUFNLGdGQUMzRCwwREFBcUQsTUFBTTtBQUNqRSxTQUFPO0FBQUEsSUFDTCxzQkFBc0IsT0FBTztBQUFBLElBQzdCO0FBQUEsSUFDQSxlQUFlLFlBQVksUUFBUTtBQUFBLElBQ25DO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBV08sU0FBUyxtQkFBbUIsTUFBc0I7QUFDdkQsTUFBSSxLQUFLLFNBQVMsWUFBWSxFQUFHLFFBQU87QUFDeEMsU0FBTztBQUFBLEVBQWUsSUFBSTtBQUFBO0FBQzVCO0FBT0EsU0FBUywwQkFBMEIsWUFBaUMsWUFBNEI7QUFDOUYsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQSxlQUFlLFlBQVksVUFBVTtBQUFBLElBQ3JDO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBT0EsU0FBUyx1QkFBdUIsUUFBd0I7QUFDdEQsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLEtBQUssTUFBTTtBQUFBLElBQ1g7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBVUEsU0FBUyxzQkFBc0IsV0FBcUIsT0FBaUIsV0FBVyxjQUFjLE9BQWU7QUFDM0csUUFBTSxRQUFRLFVBQVUsSUFBSSxDQUFDLFNBQVMsS0FBSyxJQUFJLEVBQUU7QUFDakQsTUFBSSxhQUFhO0FBQ2YsVUFBTUMsUUFBTyxDQUFDLGNBQWMsR0FBRyxPQUFPLElBQUksNENBQTRDO0FBQ3RGLFFBQUksU0FBUyxXQUFXO0FBQ3RCLE1BQUFBLE1BQUssS0FBSyxJQUFJLCtEQUErRDtBQUFBLElBQy9FO0FBQ0EsSUFBQUEsTUFBSyxLQUFLLGFBQWE7QUFDdkIsV0FBT0EsTUFBSyxLQUFLLElBQUk7QUFBQSxFQUN2QjtBQUNBLFFBQU0sT0FBTztBQUFBLElBQ1g7QUFBQSxJQUNBLEdBQUc7QUFBQSxJQUNIO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNBLE1BQUksU0FBUyxXQUFXO0FBQ3RCLFNBQUssS0FBSyxJQUFJLCtEQUErRDtBQUFBLEVBQy9FO0FBQ0EsT0FBSyxLQUFLLElBQUksb0RBQW9ELGFBQWE7QUFDL0UsU0FBTyxLQUFLLEtBQUssSUFBSTtBQUN2QjtBQVlBLElBQU0scUJBQXFCO0FBRzNCLFNBQVMsU0FBUyxNQUFnQixLQUFhLFdBQTZCO0FBQzFFLE1BQUk7QUFDRixVQUFNLE1BQU1DLGNBQWEsT0FBTyxNQUFNO0FBQUEsTUFDcEM7QUFBQSxNQUNBLFVBQVU7QUFBQSxNQUNWLE9BQU8sQ0FBQyxVQUFVLFFBQVEsUUFBUTtBQUFBLE1BQ2xDLFNBQVM7QUFBQSxJQUNYLENBQUM7QUFDRCxXQUFPLElBQ0osTUFBTSxJQUFJLEVBQ1YsSUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDekIsT0FBTyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsRUFDaEMsSUFBSSxPQUFPO0FBQUEsRUFDaEIsUUFBUTtBQUNOLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDRjtBQVFBLFNBQVMsZUFBZSxNQUFnQixLQUFhLFdBQW9DO0FBQ3ZGLE1BQUk7QUFDRixVQUFNLE1BQU1BLGNBQWEsT0FBTyxNQUFNO0FBQUEsTUFDcEM7QUFBQSxNQUNBLFVBQVU7QUFBQSxNQUNWLE9BQU8sQ0FBQyxVQUFVLFFBQVEsUUFBUTtBQUFBLE1BQ2xDLFNBQVM7QUFBQSxJQUNYLENBQUM7QUFDRCxXQUFPLElBQ0osTUFBTSxJQUFJLEVBQ1YsSUFBSSxDQUFDLFNBQVMsS0FBSyxLQUFLLENBQUMsRUFDekIsT0FBTyxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUMsRUFDaEMsSUFBSSxPQUFPO0FBQUEsRUFDaEIsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFHTyxTQUFTLHlCQUF5QixZQUFvQixvQkFBaUM7QUFDNUYsU0FBTztBQUFBLElBQ0wsYUFBYSxPQUFPLFFBQVE7QUFDMUIsWUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLFVBQUksQ0FBQyxTQUFVLFFBQU8sQ0FBQztBQUN2QixhQUFPLFNBQVMsQ0FBQyxNQUFNLFVBQVUsUUFBUSxZQUFZLGFBQWEsR0FBRyxVQUFVLFNBQVM7QUFBQSxJQUMxRjtBQUFBLElBQ0Esc0JBQXNCLE9BQU8sUUFBUTtBQUNuQyxZQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBSSxDQUFDLFNBQVUsUUFBTyxDQUFDO0FBQ3ZCLGFBQU8sU0FBUyxDQUFDLE1BQU0sVUFBVSxRQUFRLGFBQWEsR0FBRyxVQUFVLFNBQVM7QUFBQSxJQUM5RTtBQUFBLElBQ0EsZUFBZSxPQUFPLFFBQVE7QUFDNUIsWUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLFVBQUksQ0FBQyxTQUFVLFFBQU8sQ0FBQztBQUN2QixZQUFNLFdBQVcsZUFBZSxDQUFDLE1BQU0sVUFBVSxRQUFRLGVBQWUsWUFBWSxHQUFHLFVBQVUsU0FBUztBQUMxRyxVQUFJLGFBQWEsS0FBTSxRQUFPO0FBRzlCLFlBQU0sT0FBTyxTQUFTLENBQUMsTUFBTSxVQUFVLGNBQWMsUUFBUSxhQUFhLEdBQUcsVUFBVSxTQUFTLEVBQUUsQ0FBQztBQUNuRyxVQUFJLENBQUMsS0FBTSxRQUFPLENBQUM7QUFDbkIsYUFBTyxTQUFTLENBQUMsTUFBTSxVQUFVLFFBQVEsZUFBZSxHQUFHLElBQUksUUFBUSxHQUFHLFVBQVUsU0FBUztBQUFBLElBQy9GO0FBQUEsSUFDQSxlQUFlLE9BQU8sT0FBTyxRQUFRO0FBQ25DLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsWUFBWSxNQUFNLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFHN0MsYUFBTyxTQUFTLENBQUMsTUFBTSxVQUFVLFFBQVEsUUFBUSxlQUFlLE1BQU0sR0FBRyxLQUFLLEdBQUcsVUFBVSxTQUFTO0FBQUEsSUFDdEc7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLDJCQUEyQixZQUFvQixvQkFBbUM7QUFDaEcsU0FBTztBQUFBLElBQ0wsS0FBSyxPQUFPLE9BQU8sUUFBUTtBQUN6QixZQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBSSxDQUFDLFlBQVksTUFBTSxXQUFXLEVBQUc7QUFDckMsVUFBSTtBQUNGLFFBQUFBLGNBQWEsT0FBTyxDQUFDLFFBQVEsU0FBUyxHQUFHLE9BQU8sT0FBTyxHQUFHO0FBQUEsVUFDeEQsS0FBSztBQUFBLFVBQ0wsVUFBVTtBQUFBLFVBQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxNQUFNO0FBQUEsVUFDaEMsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0gsUUFBUTtBQUFBLE1BSVI7QUFBQSxJQUNGO0FBQUEsSUFDQSxPQUFPLE9BQU8sT0FBTyxRQUFRO0FBQzNCLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsWUFBWSxNQUFNLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFDN0MsVUFBSTtBQUNKLFVBQUk7QUFDRixjQUFNQSxjQUFhLE9BQU8sQ0FBQyxRQUFRLFNBQVMsWUFBWSxhQUFhLEdBQUcsS0FBSyxHQUFHO0FBQUEsVUFDOUUsS0FBSztBQUFBLFVBQ0wsVUFBVTtBQUFBLFVBQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxNQUFNO0FBQUEsVUFDaEMsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0gsU0FBUyxLQUFLO0FBVVosY0FBTSxTQUFVLElBQTRCO0FBQzVDLGNBQU0sU0FBVSxJQUE0QjtBQUM1QyxjQUFNLGFBQWEsT0FBTyxXQUFXLFdBQVcsU0FBUztBQUN6RCxjQUFNLGFBQWEsT0FBTyxXQUFXLFdBQVcsU0FBUztBQUN6RCxZQUFJLFdBQVcsS0FBSyxFQUFFLFdBQVcsS0FBSyxXQUFXLEtBQUssRUFBRSxTQUFTLEdBQUc7QUFDbEUsZ0JBQU0sSUFBSSxjQUFjLFdBQVcsS0FBSyxDQUFDO0FBQUEsUUFDM0M7QUFDQSxjQUFNO0FBQUEsTUFDUjtBQUNBLGFBQU8sb0JBQW9CLEdBQUc7QUFBQSxJQUNoQztBQUFBLElBQ0EsTUFBTSxPQUFPLE9BQU8sUUFBUTtBQUMxQixZQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBSSxDQUFDLFlBQVksTUFBTSxXQUFXLEVBQUcsUUFBTyxDQUFDO0FBQzdDLFVBQUk7QUFDRixjQUFNLE1BQU1BLGNBQWEsT0FBTyxDQUFDLFFBQVEsUUFBUSxlQUFlLEdBQUcsS0FBSyxHQUFHO0FBQUEsVUFDekUsS0FBSztBQUFBLFVBQ0wsVUFBVTtBQUFBLFVBQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxNQUFNO0FBQUEsVUFDaEMsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUNELGVBQU8sZUFBZSxHQUFHO0FBQUEsTUFDM0IsUUFBUTtBQUNOLGVBQU8sQ0FBQztBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxZQUFZLE9BQU8sT0FBTyxRQUFRO0FBQ2hDLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsWUFBWSxNQUFNLFdBQVcsRUFBRyxRQUFPO0FBQzVDLFVBQUk7QUFDRixlQUFPQSxjQUFhLE9BQU8sQ0FBQyxRQUFRLFFBQVEsR0FBRyxLQUFLLEdBQUc7QUFBQSxVQUNyRCxLQUFLO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLE1BQU07QUFBQSxVQUNoQyxTQUFTO0FBQUEsUUFDWCxDQUFDO0FBQUEsTUFDSCxRQUFRO0FBR04sZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBVU8sU0FBUyx3QkFBd0IsS0FBNEI7QUFDbEUsUUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLE1BQUksQ0FBQyxVQUFVO0FBR2IsV0FBTyxFQUFFLEtBQUssTUFBTSxPQUFPLFFBQVEsTUFBTSxNQUFNO0FBQUEsRUFDakQ7QUFDQSxRQUFNLE1BQU0sWUFBWSxRQUFRO0FBQ2hDLFNBQU87QUFBQSxJQUNMLEtBQUssQ0FBQyxXQUFXO0FBQ2YsVUFBSTtBQUNGLGVBQVUsZUFBb0IsZUFBSyxLQUFLLE1BQU0sQ0FBQztBQUFBLE1BQ2pELFFBQVE7QUFDTixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFBQSxJQUNBLFFBQVEsQ0FBQyxXQUFXO0FBQ2xCLFVBQUk7QUFDRixRQUFHLGNBQVUsS0FBSyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQ3JDLFFBQUcsa0JBQXVCLGVBQUssS0FBSyxNQUFNLEdBQUcsRUFBRTtBQUMvQyxlQUFPO0FBQUEsTUFDVCxRQUFRO0FBR04sZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGOzs7QUl0dENBLElBQU0sdUJBQXVCO0FBU3RCLFNBQVMsb0JBQW9CLFdBQW1DO0FBQ3JFLE1BQUksY0FBYyxRQUFRLE9BQU8sY0FBYyxZQUFZLEVBQUUsYUFBYSxXQUFZLFFBQU87QUFDN0YsUUFBTSxVQUFXLFVBQW1DO0FBQ3BELE1BQUksT0FBTyxZQUFZLFNBQVUsUUFBTyxRQUFRLFNBQVMsSUFBSSxVQUFVO0FBQ3ZFLE1BQUksTUFBTSxRQUFRLE9BQU8sR0FBRztBQUMxQixVQUFNLFFBQVEsUUFBUSxPQUFPLENBQUMsTUFBbUIsT0FBTyxNQUFNLFFBQVE7QUFDdEUsUUFBSSxNQUFNLFdBQVcsRUFBRyxRQUFPO0FBQy9CLFVBQU0sVUFBVSxNQUFNLFVBQVUsQ0FBQyxNQUFNLE1BQU0sUUFBUSxNQUFNLFNBQVMsTUFBTSxLQUFLO0FBQy9FLFFBQUksV0FBVyxLQUFLLE1BQU0sVUFBVSxDQUFDLE1BQU0sT0FBVyxRQUFPLE1BQU0sVUFBVSxDQUFDO0FBQzlFLFdBQU8sTUFBTSxLQUFLLEdBQUc7QUFBQSxFQUN2QjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsY0FDZCxNQUFtQix5QkFBeUIsR0FDNUMsWUFBMkIsMkJBQTJCLEdBQ3RELGNBQThDLHlCQUs5QyxXQUFvQixzQkFDcEI7QUFDQSxTQUFPLE9BQU8sT0FBd0IsUUFBcUI7QUFDekQsUUFBSTtBQUdGLFVBQUksT0FBTyxLQUFLLHFDQUFxQyxFQUFFLFdBQVcsTUFBTSxVQUFVLENBQUM7QUFFbkYsWUFBTSxVQUFVLG9CQUFvQixNQUFNLFVBQVU7QUFDcEQsVUFBSSxZQUFZLEtBQU0sUUFBTztBQUU3QixZQUFNLFNBQVMsZ0JBQWdCLE9BQU87QUFDdEMsVUFBSSxPQUFPLFNBQVMsT0FBUSxRQUFPO0FBRW5DLFlBQU0sTUFBTSxNQUFNLE9BQU87QUFDekIsWUFBTSxNQUFNLE9BQU8sU0FBUyxXQUFXLGdCQUFnQixPQUFPLElBQUk7QUFDbEUsWUFBTSxZQUFZLE1BQU0saUJBQWlCLE9BQU8sTUFBTSxLQUFLLEtBQUssS0FBSyxPQUFPLEtBQUs7QUFFakYsWUFBTSxPQUFPLE9BQU8sU0FBUyxXQUFXLFdBQVc7QUFDbkQsWUFBTSxTQUFTLE1BQU0sYUFBYSxXQUFXLEtBQUssV0FBVyxZQUFZLEdBQUcsR0FBRyxJQUFJO0FBQ25GLFVBQUksT0FBTyxhQUFhLFFBQVE7QUFJOUIsWUFBSSxPQUFPLFNBQVMsbUJBQW1CLE9BQU8sU0FBUyxlQUFlO0FBQ3BFLGNBQUksT0FBTyxLQUFLLHNEQUFzRCxFQUFFLFFBQVEsT0FBTyxPQUFPLENBQUM7QUFDL0YsaUJBQU8saUJBQWlCO0FBQUEsWUFDdEIsbUJBQW1CLG1CQUFtQixPQUFPLE1BQU07QUFBQSxZQUNuRCxlQUFlLE9BQU87QUFBQSxVQUN4QixDQUFDO0FBQUEsUUFDSDtBQUdBLFlBQUksT0FBTyxTQUFTLDZCQUE2QixPQUFPLFNBQVMseUJBQXlCO0FBQ3hGLGlCQUFPLGlCQUFpQjtBQUFBLFlBQ3RCLG1CQUFtQixtQkFBbUIsT0FBTyxNQUFNO0FBQUEsWUFDbkQsZUFBZSxPQUFPO0FBQUEsVUFDeEIsQ0FBQztBQUFBLFFBQ0g7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUVBLFVBQUksVUFBVTtBQUVaLGVBQU8saUJBQWlCO0FBQUEsVUFDdEIsb0JBQW9CO0FBQUEsVUFDcEIsMEJBQTBCLE9BQU87QUFBQSxVQUNqQyxlQUFlLE9BQU87QUFBQSxRQUN4QixDQUFDO0FBQUEsTUFDSDtBQUdBLFlBQU0sVUFBVTtBQUFBLEVBQTBFLE9BQU8sTUFBTTtBQUN2RyxhQUFPLGlCQUFpQixFQUFFLG1CQUFtQixtQkFBbUIsT0FBTyxHQUFHLGVBQWUsUUFBUSxDQUFDO0FBQUEsSUFDcEcsU0FBUyxLQUFLO0FBQ1osVUFBSSxPQUFPLEtBQUssa0RBQWtELEVBQUUsSUFBSSxDQUFDO0FBQ3pFLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNGO0FBRUEsSUFBTyxlQUFRLGVBQWUsRUFBRSxTQUFTLCtCQUErQixTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQ3BKMUcsUUFBUSxZQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJjYW5kaWRhdGVzIiwgInN0YWdlZCIsICJ0cmFja2VkIiwgInNlZW4iLCAidW5jb3ZlcmVkIiwgImNsb3NpbmciLCAiYm9keSIsICJleGVjRmlsZVN5bmMiXQp9Cg==
